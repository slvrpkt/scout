import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { JobStage } from "@/lib/calendar-view";

// Which calendar events are part of a job search, for the dashboard
// calendar's capsules: decided from what's already known, never by the AI,
// so it costs nothing. From surest to loosest: an event Scout tied to an
// application; the name of a company applied to; a guest from that
// company's mail domain or one that wrote about an application; an
// interview-scheduling tool; and, last, job words such as "phone screen".

/** An application an event may be about: only open ones are matched by name or domain. */
export type JobContext = {
  applications: { id: string; company: string; status: ApplicationStatus }[];
  /** Mail domains tied to an application, from the mail Scout matched to it. */
  domains: Map<string, string>;
};

export type JobEvent = { title: string; description: string; location: string; emails: string[] };

export type JobMatch = { stage: JobStage; applicationId: string | null; company: string | null };

/** Domains anyone can mail from: they say nothing about the employer. */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

/** Tools recruiters book interviews with. */
const SCHEDULERS = [
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "myworkdayjobs.com",
  "workday.com",
  "ashbyhq.com",
  "calendly.com",
  "goodtime.io",
  "smartrecruiters.com",
  "icims.com",
  "jobvite.com",
  "workable.com",
  "rippling.com",
];

const OFFER = /\b(offer|final round|final interview)\b/i;
const INTERVIEW = /\b(interview|interviews|round\s*\d|technical|onsite|on-site|panel|case study|take-home)\b/i;
const SCREENING = /\b(phone screen|screening|screen call|recruiter|hiring manager|talent acquisition|intro(?:ductory)? call)\b/i;

/** Company name endings that would match too widely on their own. */
const SUFFIXES = /\b(inc|llc|ltd|corp|corporation|company|co|group|gmbh|plc|limited)\.?$/i;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The part of a company's name that's worth matching, or null when it's too short to tell. */
function matchableName(company: string): string | null {
  const name = company.trim().replace(/[,.]+$/, "").replace(SUFFIXES, "").trim();
  return name.length >= 3 ? name : null;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase().trim() ?? "";
const covers = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Where in the process an event is: its words first, then the application's status. */
function stageOf(text: string, status: ApplicationStatus | null): JobStage {
  if (OFFER.test(text) || status === "OFFER" || status === "ACCEPTED") return "offer";
  if (INTERVIEW.test(text) || status === "INTERVIEW") return "interview";
  return "screening";
}

/**
 * Whether an event is part of a job search, and its stage; null for
 * everything else. `taggedApplicationId` is the application Scout tied the
 * event to, when it did.
 */
export function classifyEvent(event: JobEvent, context: JobContext, taggedApplicationId: string | null = null): JobMatch | null {
  const text = [event.title, event.description, event.location].join("\n");
  const byId = new Map(context.applications.map((application) => [application.id, application]));
  const found = (id: string | null) => {
    const application = id ? byId.get(id) : undefined;
    return { stage: stageOf(text, application?.status ?? null), applicationId: application?.id ?? id, company: application?.company || null };
  };

  // 1. Tied to an application by Scout.
  if (taggedApplicationId) return { ...found(taggedApplicationId), stage: stageOf(text, byId.get(taggedApplicationId)?.status ?? "INTERVIEW") };

  // 2. Names a company applied to.
  for (const application of context.applications) {
    const name = matchableName(application.company);
    if (name && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) return found(application.id);
  }

  // 3. A guest from an employer's mail domain.
  for (const email of event.emails) {
    const domain = domainOf(email);
    if (!domain || FREE_MAIL.has(domain)) continue;
    for (const [known, applicationId] of context.domains) if (covers(domain, known)) return found(applicationId);
  }

  // 4. Booked through an interview-scheduling tool: by a guest, or a link in the description.
  const hosts = [...event.emails.map(domainOf), ...[...event.description.matchAll(/https?:\/\/([^/\s"'<>]+)/gi)].map((match) => match[1].toLowerCase())];
  if (hosts.some((host) => SCHEDULERS.some((tool) => covers(host, tool)))) return found(null);

  // 5. Job words alone, last: they can misfire on a personal "interview".
  // "Offer" alone is too common ("special offer"), so only an offer call or a final round counts here.
  if (/\b(offer call|offer discussion|final round|final interview)\b/i.test(text) || INTERVIEW.test(text) || SCREENING.test(text)) return found(null);
  return null;
}
