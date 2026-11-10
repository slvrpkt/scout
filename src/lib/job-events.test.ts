import { describe, expect, it } from "vitest";

import { classifyEvent, type JobContext } from "./job-events";

const context: JobContext = {
  applications: [
    { id: "nw", company: "Northwind Inc.", status: "SCREENING" },
    { id: "lg", company: "Ledgerly", status: "INTERVIEW" },
    { id: "ok", company: "Oaken Studio", status: "OFFER" },
    { id: "x", company: "X", status: "SENT" },
  ],
  domains: new Map([["northwind.com", "nw"]]),
};
const event = (extra: Partial<Parameters<typeof classifyEvent>[0]> = {}) => ({ title: "", description: "", location: "", emails: [], ...extra });

describe("telling job events apart, without the AI", () => {
  it("knows the events Scout tied to an application", () => {
    expect(classifyEvent(event({ title: "Catch-up" }), context, "lg")).toEqual({ stage: "interview", applicationId: "lg", company: "Ledgerly" });
  });

  it("matches a company applied to by its name, whole words only, without its Inc", () => {
    expect(classifyEvent(event({ title: "Call with Northwind" }), context)).toMatchObject({ applicationId: "nw", stage: "screening" });
    expect(classifyEvent(event({ title: "Ledgerly – round 2" }), context)).toMatchObject({ applicationId: "lg", stage: "interview" });
    expect(classifyEvent(event({ title: "Northwinders meetup" }), context)).toBeNull();
    // Too short to tell: "X" would match everywhere.
    expect(classifyEvent(event({ title: "Lunch at X bar" }), context)).toBeNull();
  });

  it("matches a guest from an employer's mail domain, not free mail", () => {
    expect(classifyEvent(event({ title: "Chat", emails: ["sam@careers.northwind.com"] }), context)).toMatchObject({ applicationId: "nw" });
    expect(classifyEvent(event({ title: "Chat", emails: ["sam@gmail.com"] }), context)).toBeNull();
  });

  it("knows interview-scheduling tools and job words", () => {
    expect(classifyEvent(event({ title: "Chat", emails: ["no-reply@calendly.com"] }), context)).toMatchObject({ applicationId: null, stage: "screening" });
    expect(classifyEvent(event({ title: "Meeting", description: "Join: https://app.greenhouse.io/x" }), context)).not.toBeNull();
    expect(classifyEvent(event({ title: "Phone screen" }), context)).toMatchObject({ stage: "screening" });
    expect(classifyEvent(event({ title: "Technical interview" }), context)).toMatchObject({ stage: "interview" });
    expect(classifyEvent(event({ title: "Final round" }), context)).toMatchObject({ stage: "offer" });
    expect(classifyEvent(event({ title: "Special offer at the gym" }), context)).toBeNull();
    expect(classifyEvent(event({ title: "Dentist" }), context)).toBeNull();
  });

  it("colours by stage: the words first, then the application's status", () => {
    expect(classifyEvent(event({ title: "Oaken Studio chat" }), context)).toMatchObject({ stage: "offer" });
    expect(classifyEvent(event({ title: "Ledgerly offer call" }), context)).toMatchObject({ stage: "offer" });
  });
});
