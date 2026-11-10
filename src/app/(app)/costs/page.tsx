import { redirect } from "next/navigation";

import { settingsSectionHref } from "../settings/sections";

/** Estimated cost lives in Settings now; an old link lands there. */
export default function CostsPage() {
  redirect(settingsSectionHref("costs"));
}
