import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import { signOut } from "./actions";
import { endSession } from "./session";

vi.mock("./session", () => ({ endSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// Password sign-in, without the environment a server has.
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("./oidc", () => ({ authMode: () => "password", signOutUrl: () => null }));

describe("signOut", () => {
  it("deletes the session cookie and goes to the sign-in page", async () => {
    await signOut();
    expect(endSession).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
