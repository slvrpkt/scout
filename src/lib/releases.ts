// Where Scout's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "slvrpkt/scout";
/** The repository's page, for credits and support (the sidebar). */
export const REPOSITORY_URL = `https://github.com/${RELEASES_REPOSITORY}`;
/** How to update, in the README. */
export const UPGRADE_GUIDE_URL = `${REPOSITORY_URL}#updating`;
/** Where to ask for help or report a problem. */
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };
