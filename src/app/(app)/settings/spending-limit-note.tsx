// Shown by every field that takes an API key: Scout's agents run on their
// own, so a key without a spending limit at its provider could run up a
// large bill if something goes wrong, such as an agent searching over and over.

export type KeyProvider = "ANTHROPIC" | "OPENAI" | "MISTRAL" | "JSEARCH" | "ADZUNA" | "TYPESAFE" | "GOOGLE";

/** Who the key is from, and where that provider lets you cap what it costs. */
const WHERE: Record<KeyProvider, { name: string; limit: string }> = {
  ANTHROPIC: { name: "Anthropic", limit: "a monthly spending limit in the Anthropic Console (Settings → Limits)" },
  OPENAI: { name: "your AI provider", limit: "a monthly budget or usage limit in your provider's dashboard (for OpenAI: Settings → Limits)" },
  MISTRAL: { name: "Mistral", limit: "a spending limit in Mistral's console (Billing)" },
  JSEARCH: { name: "JSearch", limit: "a plan with a fixed number of requests a month, not open-ended pay-as-you-go (OpenWeb Ninja or RapidAPI)" },
  ADZUNA: { name: "Adzuna", limit: "Adzuna's request quota for your app, kept at what you need" },
  TYPESAFE: { name: "TypeSafe", limit: "a usage limit in TypeSafe's console" },
  GOOGLE: { name: "Google Cloud", limit: "a budget alert in Google Cloud Console (Billing → Budgets & alerts); Gmail and Calendar are normally free, but it's worth having" },
};

/** "Set a hard spending limit before you add this key", for the key's provider. */
export function SpendingLimitNote({ provider }: { provider: KeyProvider }) {
  const { name, limit } = WHERE[provider];
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-warning bg-warning-surface px-4 py-3 text-meta text-warning">
      <span className="text-label font-medium">Set a hard spending limit before you add this key</span>
      <span>
        Scout&apos;s agents run on their own. If something goes wrong, such as an agent repeating the same searches, a key with no billing limit could run up an
        unexpectedly large bill. We strongly recommend {limit}, as well as Scout&apos;s own daily and monthly limits in Settings → Estimated cost, which pause it
        when they&apos;re reached. Keys from {name} with no billing limit are strongly discouraged.
      </span>
    </div>
  );
}
