import netherlands from "./prototype-sample.json";
import unitedStates from "./prototype-sample.us.json";

// The demo data (Jane Doe is made up). Dossier's prototype placed her in
// Rotterdam, and its tests expect that; Scout's README screenshots move her to
// the US with DOSSIER_DEMO_REGION=us (Arlington, VA, dollars and miles).

type Sample = typeof netherlands & { profile: typeof netherlands.profile & { state?: string; zip?: string } };

export const sample: Sample =
  process.env.DOSSIER_DEMO_REGION === "us" ? (unitedStates as unknown as Sample) : netherlands;
