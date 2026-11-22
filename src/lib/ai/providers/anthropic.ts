import { costOfTokens, WEB_SEARCH_COST, type CostCenter, type TokenUse } from "@/lib/cost-rates";
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { openBatchWindow } from "../batch-window";
import { AiError } from "../errors";
import { BaseProvider, DEFAULT_MAX_TOKENS, SCHEMA_REFUSED, withJsonSchema, type BatchItem, type ChatAnswer, type JsonCompletionRequest, type ChatCall, type Effort, type WebSearchRequest } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";

/** Offered when the model list can't be fetched, e.g. before a key is saved. */
export const ANTHROPIC_FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"];

/**
 * Current models think before they answer unless told otherwise, and the
 * thinking counts towards `max_tokens`: without room on top, a long think
 * leaves none for the answer.
 */
const THINKING_TOKENS = 12_000;

// The effort levels each server and model takes, looked up once: older
// models, such as Claude Haiku 4.5, refuse the parameter.
const effortLevels = new Map<string, ReadonlySet<Effort>>();

// Schemas the API refused for structured output, by server, model and schema
// name: it caps how complex one may be (union-typed and optional parameters,
// grammar size), so large ones, such as a whole profile, go in the prompt
// instead (#230).
const promptSchemas = new Set<string>();

/** How often a batched call checks whether its batch is done. */
export const BATCH_POLL_MS = 15_000;

/** Waits `ms`, or until `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** Claude through the Messages API with the user's own key. */
/** Notes what a request cost, on the side: it never holds up or fails the request. */
async function noteCost(model: string, usage: TokenUse, kind: string, batch: boolean): Promise<void> {
  await import("@/lib/costs").then(({ recordCost }) => recordCost("ANTHROPIC", kind, costOfTokens(model, usage, { batch }))).catch(() => {});
}

/** A request as the Messages API takes it; text that stays the same between requests is marked to be cached. */
function paramsFor(call: ChatCall, effort: Effort | undefined, structured: boolean) {
  const format = call.json && structured ? { format: zodOutputFormat(call.json.schema) } : {};
  const outputConfig = { ...format, ...(effort ? { effort } : {}) };
  return {
    model: call.model,
    max_tokens: call.maxTokens + THINKING_TOKENS,
    system: call.json && !structured ? withJsonSchema(call.system, call.json.schema) : call.system,
    messages: call.messages.map(({ role, content, cached }) => ({
      role,
      content: cached ? [{ type: "text" as const, text: cached, cache_control: { type: "ephemeral" as const } }, { type: "text" as const, text: content }] : content,
    })),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
}

export class AnthropicProvider extends BaseProvider {
  readonly kind = "ANTHROPIC" as const;
  private readonly client: Anthropic | null;

  constructor(
    private readonly baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
    // The SDK sends the key as a bearer token since 1.0. The Claude API takes
    // either header, but a gateway at a base URL of the user's own may only
    // read X-Api-Key, as every request before did.
    const keyHeader = { "X-Api-Key": apiKey, Authorization: null };
    this.client = apiKey
      ? new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 1, fetch: keyGuardedFetch(), defaultHeaders: keyHeader })
      : null;
  }

  protected override cachesPrompts(): boolean {
    return true;
  }

  protected override batchesInWindow(): boolean {
    return true;
  }

  protected override costCenter(): CostCenter {
    return "ANTHROPIC";
  }

  async sendBatch(items: readonly BatchItem[]): Promise<string> {
    if (!this.client) throw AiError.config("Add your Anthropic API key in Settings → AI provider first.");
    const model = this.model;
    if (!model) throw AiError.config("Choose a model in Settings → AI provider first.");
    const signal = AbortSignal.timeout(60_000);
    const levels = await this.effortLevels(this.client, model, signal);
    const batch = await this.client.messages.batches.create({
      requests: items.map(({ id, request }) => ({
        custom_id: id,
        params: paramsFor(
          { model, system: request.system, messages: request.messages, maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS, signal, json: "schema" in request ? { schema: (request as JsonCompletionRequest<unknown>).schema, name: "result" } : undefined },
          request.effort && levels.has(request.effort) ? request.effort : undefined,
          true,
        ),
      })),
    });
    return batch.id;
  }

  async batchResults(id: string): Promise<Map<string, string> | null> {
    if (!this.client) return null;
    const batch = await this.client.messages.batches.retrieve(id);
    if (batch.processing_status !== "ended") return null;
    const answers = new Map<string, string>();
    for await (const entry of await this.client.messages.batches.results(id)) {
      if (entry.result.type !== "succeeded") continue;
      await noteCost(entry.result.message.model, entry.result.message.usage, "posting_score", true);
      answers.set(entry.custom_id, entry.result.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
    }
    return answers;
  }

  async cancelBatch(id: string): Promise<void> {
    await this.client?.messages.batches.cancel(id);
  }

  /**
   * A question answered with Claude's web search tool. Searches can pause a
   * long turn; it's sent again to carry on, a few times at most. Each request
   * costs its tokens and $0.01 a search.
   */
  async searchWeb({ system, prompt, maxSearches, blockedDomains = [], kind, signal = AbortSignal.timeout(this.timeoutMs) }: WebSearchRequest): Promise<string> {
    if (!this.client) throw AiError.config("Add your Anthropic API key in Settings → AI provider first.");
    const model = this.model;
    if (!model) throw AiError.config("Choose a model in Settings → AI provider first.");
    await this.withinCostLimit();
    const tool = { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxSearches, ...(blockedDomains.length > 0 ? { blocked_domains: [...blockedDomains] } : {}) };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    for (let turn = 0; turn < 3; turn++) {
      const message = await this.client.messages.create({ model, max_tokens: 2048, system, messages, tools: [tool] }, { signal });
      const searches = message.usage.server_tool_use?.web_search_requests ?? 0;
      await import("@/lib/costs").then(({ recordCost }) => recordCost("ANTHROPIC", kind, costOfTokens(model, message.usage) + searches * WEB_SEARCH_COST)).catch(() => {});
      if (message.stop_reason !== "pause_turn") return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      messages.push({ role: "assistant", content: message.content });
    }
    return "";
  }

  /** Current Claude models reject `temperature`; creativity is in the prompt's wording instead. */
  protected override acceptsTemperature(): boolean {
    return false;
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    if (!this.client) throw AiError.config("Add your Anthropic API key in Settings → AI provider first.");
    const effort = call.effort && (await this.effortLevels(this.client, call.model, call.signal)).has(call.effort) ? call.effort : undefined;
    const schemaKey = call.json ? `${this.baseURL} ${call.model} ${call.json.name}` : "";
    // In a batch window, half price if the answer comes back in time; otherwise sent as usual below.
    const batched = await this.viaBatch(this.client, call, effort, Boolean(call.json) && !promptSchemas.has(schemaKey));
    if (batched) return batched;
    if (!call.json || promptSchemas.has(schemaKey)) return this.send(this.client, call, effort, false);
    try {
      return await this.send(this.client, call, effort, true);
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError && SCHEMA_REFUSED.test(error.message))) throw error;
      promptSchemas.add(schemaKey);
      return this.send(this.client, call, effort, false);
    }
  }

  /**
   * The call as a batch of one, inside a batch window: its answer at half
   * price, or null when it isn't back within the window's wait (the window
   * then closes, so the rest of the work goes at the normal price) or the
   * batch couldn't answer it. While it waits, other jobs may run.
   */
  private async viaBatch(client: Anthropic, call: ChatCall, effort: Effort | undefined, structured: boolean): Promise<ChatAnswer | null> {
    const window = openBatchWindow();
    if (!window) return null;
    const deadline = Date.now() + window.stepMs;
    let batch: Anthropic.Messages.MessageBatch;
    try {
      batch = await client.messages.batches.create({ requests: [{ custom_id: "step", params: paramsFor(call, effort, structured) }] }, { signal: call.signal });
    } catch (error) {
      if (call.signal.aborted) throw error;
      // No batches just now: this work goes at the normal price.
      window.expired = true;
      return null;
    }
    const { waitOutsideLimit } = await import("@/lib/jobs/runner");
    const message = await waitOutsideLimit(this.batchAnswer(client, batch.id, deadline, call.signal));
    if (!message) {
      window.expired = true;
      await client.messages.batches.cancel(batch.id).catch(() => {});
      return null;
    }
    await noteCost(call.model, message.usage, call.json?.name ?? "other", true);
    if (message.stop_reason === "refusal") {
      throw new AiError("provider", "The model declined to answer this one. Try rewording it, or try again.", "refusal");
    }
    return {
      text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      cutOff: message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded",
    };
  }

  /** A batch of one's answer once it's done, or null past `deadline` or when it failed. */
  private async batchAnswer(client: Anthropic, id: string, deadline: number, signal: AbortSignal): Promise<Anthropic.Message | null> {
    while (Date.now() < deadline) {
      await pause(Math.min(BATCH_POLL_MS, Math.max(0, deadline - Date.now())), signal);
      if ((await client.messages.batches.retrieve(id, {}, { signal })).processing_status !== "ended") continue;
      for await (const entry of await client.messages.batches.results(id, {}, { signal })) {
        return entry.result.type === "succeeded" ? entry.result.message : null;
      }
      return null;
    }
    return null;
  }

  /** One request; `structured` asks for `call.json` through output_config, otherwise the schema goes in the prompt. */
  private async send(client: Anthropic, call: ChatCall, effort: Effort | undefined, structured: boolean): Promise<ChatAnswer> {
    const message = await client.messages.create(paramsFor(call, effort, structured), { signal: call.signal });
    await noteCost(call.model, message.usage, call.json?.name ?? "other", false);
    if (message.stop_reason === "refusal") {
      throw new AiError("provider", "The model declined to answer this one. Try rewording it, or try again.", "refusal");
    }
    return {
      text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      cutOff: message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded",
    };
  }

  /** The effort levels `model` takes, from the Models API; none when that can't tell. */
  private async effortLevels(client: Anthropic, model: string, signal: AbortSignal): Promise<ReadonlySet<Effort>> {
    const key = `${this.baseURL} ${model}`;
    const known = effortLevels.get(key);
    if (known) return known;
    try {
      const effort = (await client.models.retrieve(model, {}, { signal })).capabilities?.effort;
      const levels = new Set((["low", "medium", "high"] as const).filter((level) => effort?.supported && effort[level].supported));
      effortLevels.set(key, levels);
      return levels;
    } catch (error) {
      if (signal.aborted) throw error;
      // Not remembered: the call goes ahead without an effort, and the next one asks again.
      return new Set();
    }
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    if (!this.client) return ANTHROPIC_FALLBACK_MODELS;
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list({ limit: 100 }, { signal })) ids.push(model.id);
      return ids.length > 0 ? ids : ANTHROPIC_FALLBACK_MODELS;
    } catch (error) {
      if (signal.aborted) throw error;
      return ANTHROPIC_FALLBACK_MODELS;
    }
  }
}
