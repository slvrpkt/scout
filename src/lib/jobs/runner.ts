import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { JobStatus } from "@/generated/prisma/enums";
import { loadAiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { providerOption } from "@/lib/ai/provider-options";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";

// Long AI tasks run as background jobs (E6-7): the request that starts one
// returns at once with its id, the work goes on in this process, and the
// page follows its named steps (/api/jobs/[id]/events). Progress lives in
// the Job table, so a reloaded page can pick the job up again. Scout runs
// as a single instance, so an in-process queue is enough.

export type JobContext = {
  /** The job's own id, e.g. to link it to the application it makes. */
  id: string;
  /** Names the step now in progress, e.g. "Reading the posting". */
  step: (name: string) => Promise<void>;
  /** Aborts when the job is cancelled; pass it on to AI calls. */
  signal: AbortSignal;
};

export type JobDefinition<I, R> = {
  type: string;
  input: z.ZodType<I>;
  result: z.ZodType<R>;
  /**
   * Does the work. It may run again on Retry with the same input, so it must
   * write its data idempotently (upsert, or replace in one transaction).
   */
  run: (input: I, context: JobContext) => Promise<R>;
  /**
   * false: a restart doesn't start it again, it fails with JOB_MESSAGES.interrupted
   * and its own module picks up the pieces (the job agent's runs and drafts).
   */
  resumable?: boolean;
};

/** What a page learns about a job. */
export type JobView<R = unknown> = {
  id: string;
  type: string;
  status: JobStatus;
  step: string | null;
  error: string | null;
  result: R | null;
};

export const JOB_MESSAGES = {
  failed: "Something went wrong while working on this. Try again.",
  interrupted: "Scout restarted before this finished. Try again.",
  interruptedAgain: "Scout restarted before this could finish, three times in a row. Try again.",
  cancelled: "Cancelled.",
} as const;

/** How many times a job cut off by a restart is picked up again on its own; past it, one that keeps stopping Scout waits for Retry. */
export const MAX_RESUMES = 2;

/** Jobs at once: local models do best with one request at a time (PRD §11). */
const LOCAL_CONCURRENCY = 1;
const HOSTED_CONCURRENCY = 3;

type Listener = (job: JobView) => void;

type RunnerState = {
  definitions: Map<string, JobDefinition<unknown, unknown>>;
  queue: string[];
  running: Map<string, AbortController>;
  /** Running jobs waiting on something slow and cheap, such as a batch: they don't count towards the limit. */
  waiting: Set<string>;
  listeners: Map<string, Set<Listener>>;
  pumping: boolean;
};

// On globalThis, so the dev server's hot reloads keep one queue.
const globalForJobs = globalThis as unknown as { jobRunner?: RunnerState };
const state: RunnerState = (globalForJobs.jobRunner ??= {
  definitions: new Map(),
  queue: [],
  running: new Map(),
  waiting: new Set(),
  listeners: new Map(),
  pumping: false,
});
// Older hot-reloaded state, from before jobs could wait.
state.waiting ??= new Set();

/** The job the current code runs for, so a long wait inside it can free its place. */
const currentJob = new AsyncLocalStorage<string>();

/**
 * Awaits `work` without holding the current job's place among those running
 * at once: for a wait that takes minutes and no effort here, such as a batch
 * of AI calls, so other jobs can start meanwhile. Outside a job, just awaits.
 */
export async function waitOutsideLimit<T>(work: Promise<T>): Promise<T> {
  const id = currentJob.getStore();
  if (!id) return work;
  state.waiting.add(id);
  void pump();
  try {
    return await work;
  } finally {
    state.waiting.delete(id);
  }
}

/** Registers a job type; call at module level where the job is defined. */
export function defineJob<I, R>(definition: JobDefinition<I, R>): JobDefinition<I, R> {
  state.definitions.set(definition.type, definition as JobDefinition<unknown, unknown>);
  return definition;
}

const VIEW_FIELDS = { id: true, type: true, status: true, step: true, error: true, result: true } as const;

export async function getJob(id: string): Promise<JobView | null> {
  return prisma.job.findUnique({ where: { id }, select: VIEW_FIELDS });
}

/** The newest job for something on screen, e.g. "application:<id>", to reattach after a reload. */
export async function findLatestJob(key: string): Promise<JobView | null> {
  return prisma.job.findFirst({ where: { key }, orderBy: { createdAt: "desc" }, select: VIEW_FIELDS });
}

/** Jobs for something on screen that are still queued or running, oldest first, with their input. */
export async function findUnfinishedJobs(key: string): Promise<{ id: string; type: string; input: unknown }[]> {
  return prisma.job.findMany({
    where: { key, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, input: true },
  });
}

export function isFinished(job: Pick<JobView, "status">): boolean {
  return job.status === JobStatus.DONE || job.status === JobStatus.FAILED;
}

/**
 * Queues a job and returns its id right away. A job that works on an
 * application names it, so deleting the application deletes the job too.
 */
export async function startJob<I, R>(
  definition: JobDefinition<I, R>,
  input: NoInfer<I>,
  options: { key?: string; applicationId?: string } = {},
): Promise<string> {
  defineJob(definition);
  const job = await prisma.job.create({
    data: {
      type: definition.type,
      key: options.key,
      applicationId: options.applicationId,
      input: definition.input.parse(input) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  enqueue(job.id);
  return job.id;
}

/** Runs a failed job again, as the same job with the same input. */
export async function retryJob(id: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id, status: JobStatus.FAILED },
    data: { status: JobStatus.QUEUED, step: null, error: null, result: Prisma.DbNull, startedAt: null, finishedAt: null, resumes: 0 },
  });
  if (count === 0) return false;
  await notify(id);
  enqueue(id);
  return true;
}

/** Stops a queued or running job; it ends as failed with "Cancelled.". */
export async function cancelJob(id: string): Promise<void> {
  const queued = state.queue.indexOf(id);
  if (queued >= 0) {
    state.queue.splice(queued, 1);
    await finish(id, { status: JobStatus.FAILED, error: JOB_MESSAGES.cancelled });
    return;
  }
  state.running.get(id)?.abort();
}

/** Stops every queued or running job that works on an application, e.g. before it's deleted. */
export async function cancelApplicationJobs(applicationId: string): Promise<void> {
  const unfinished = await prisma.job.findMany({
    where: { applicationId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    select: { id: true },
  });
  for (const job of unfinished) await cancelJob(job.id);
}

/** Calls `listener` with the job's state after every change; returns how to stop. */
export function subscribeJob(id: string, listener: Listener): () => void {
  const listeners = state.listeners.get(id) ?? new Set();
  listeners.add(listener);
  state.listeners.set(id, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) state.listeners.delete(id);
  };
}

async function notify(id: string): Promise<void> {
  const listeners = state.listeners.get(id);
  if (!listeners?.size) return;
  const job = await getJob(id);
  if (job) for (const listener of listeners) listener(job);
}

/** Records how a job ended; one deleted meanwhile (its application, a discarded import) just ends. */
async function finish(
  id: string,
  data: { status: JobStatus; result?: Prisma.InputJsonValue; error?: string },
): Promise<void> {
  const { count } = await prisma.job.updateMany({ where: { id }, data: { ...data, finishedAt: new Date() } });
  if (count > 0) await notify(id);
}

function enqueue(id: string): void {
  if (!state.queue.includes(id)) state.queue.push(id);
  void pump();
}

async function concurrency(): Promise<number> {
  try {
    return providerOption((await loadAiConfig()).provider).local ? LOCAL_CONCURRENCY : HOSTED_CONCURRENCY;
  } catch {
    return LOCAL_CONCURRENCY;
  }
}

async function pump(): Promise<void> {
  if (state.pumping) return;
  state.pumping = true;
  try {
    const limit = await concurrency();
    while (state.queue.length > 0 && state.running.size - state.waiting.size < limit) {
      const id = state.queue.shift()!;
      const controller = new AbortController();
      state.running.set(id, controller);
      void execute(id, controller).finally(() => {
        state.running.delete(id);
        void pump();
      });
    }
  } finally {
    state.pumping = false;
  }
}

async function execute(id: string, controller: AbortController): Promise<void> {
  try {
    const job = await prisma.job.update({
      where: { id },
      data: { status: JobStatus.RUNNING, startedAt: new Date() },
      select: { type: true, input: true },
    });
    await notify(id);
    // Job types register when their module loads; make sure they all have.
    await import("./definitions");
    const definition = state.definitions.get(job.type);
    if (!definition) throw new Error(`No job type "${job.type}" is defined.`);

    const result = await currentJob.run(id, () => definition.run(definition.input.parse(job.input), {
      id,
      signal: controller.signal,
      step: async (name) => {
        // Deleted meanwhile: there's no one left to do it for.
        const { count } = await prisma.job.updateMany({ where: { id }, data: { step: name } });
        if (count === 0) controller.abort();
        else await notify(id);
      },
    }));
    await finish(id, { status: JobStatus.DONE, result: definition.result.parse(result) as Prisma.InputJsonValue });
  } catch (error) {
    // AI failures already say what to do; anything else is logged and kept vague.
    const message = controller.signal.aborted
      ? JOB_MESSAGES.cancelled
      : error instanceof AiError
        ? error.message
        : JOB_MESSAGES.failed;
    if (!(error instanceof AiError) && !controller.signal.aborted) logServerError(`job ${id}`, error);
    await finish(id, { status: JobStatus.FAILED, error: message }).catch((cause: unknown) => logServerError(`job ${id}`, cause));
  }
}

/**
 * Called once at startup: jobs a previous process left queued or running
 * start again on their own, oldest first, from the beginning (every job may
 * run twice, as Retry does). One cut off more than MAX_RESUMES times in a
 * row may be what stops Scout, so it's marked failed and the page offers Retry,
 * as is one whose module recovers it itself (resumable: false).
 */
export async function recoverInterruptedJobs(): Promise<{ resumed: number; failed: number }> {
  await import("./definitions");
  const unfinished = { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } };
  const own = [...state.definitions.values()].filter((definition) => definition.resumable === false).map((definition) => definition.type);
  const { count: handedOver } = await prisma.job.updateMany({
    where: { ...unfinished, type: { in: own } },
    data: { status: JobStatus.FAILED, error: JOB_MESSAGES.interrupted, finishedAt: new Date() },
  });
  const { count: gaveUp } = await prisma.job.updateMany({
    where: { ...unfinished, resumes: { gte: MAX_RESUMES } },
    data: { status: JobStatus.FAILED, error: JOB_MESSAGES.interruptedAgain, finishedAt: new Date() },
  });
  const failed = handedOver + gaveUp;
  const left = await prisma.job.findMany({ where: unfinished, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (left.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: left.map((job) => job.id) } },
      data: { status: JobStatus.QUEUED, step: null, startedAt: null, resumes: { increment: 1 } },
    });
    for (const job of left) enqueue(job.id);
  }
  return { resumed: left.length, failed };
}
