import { buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Sign-in with Cognito (DOSSIER_AUTH=cognito or simulated): a plain form to
 * /api/auth/start, which sends the browser to the user pool's sign-in page.
 * It needs no scripts.
 */
export function ProviderSignIn({ next, simulated, error }: { next?: string; simulated: boolean; error?: string }) {
  return (
    <form action="/api/auth/start" method="get" className="flex flex-col gap-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Welcome back</h1>
        <p className="text-sm text-muted">Sign in with your AWS Cognito account to pick up where you left off.</p>
      </div>
      {simulated && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          Simulated Cognito, for this computer only: the sign-in page is Scout&apos;s own stand-in. Set DOSSIER_AUTH=cognito on the server to use your user pool.
        </p>
      )}
      {error && (
        <p role="alert" className="text-meta text-error">
          {error}
        </p>
      )}
      <Checkbox label="Keep me signed in for 30 days" name="remember" />
      <button type="submit" className={buttonClassName("primary", "lg")}>
        Sign in with Cognito
      </button>
    </form>
  );
}
