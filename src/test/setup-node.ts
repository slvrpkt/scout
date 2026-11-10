import { vi } from "vitest";

// And should anything still reach for the database, it finds none: unit tests
// run without one, so the app's own data is out of reach.
process.env.DATABASE_URL = "postgresql://unit-tests@127.0.0.1:9/no-database-in-unit-tests";

// Unit tests never write to the database the app itself uses: a cost they
// note goes nowhere, and no cost limit is ever reached. Without this, a fake
// search's price landed in the real Estimated cost and paused real searches.
// The real module is never loaded here, so nothing can reach the database.
vi.mock("@/lib/costs", () => ({
  COST_PERIODS: [],
  recordCost: vi.fn(async () => {}),
  limitReached: vi.fn(async () => null),
  costLimitsPassed: vi.fn(async () => []),
  loadCosts: vi.fn(async () => {
    throw new Error("Unit tests don't read costs; use a .db.test.ts.");
  }),
}));
