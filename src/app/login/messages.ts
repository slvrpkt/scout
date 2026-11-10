/** Sign-in errors (PRD AUTH-4), shared by the form and the action. */
export const loginMessages = {
  empty: "Enter your password.",
  wrong: "That's not the password set on the server. Try again.",
  useProvider: "This server signs in with Cognito. Use Sign in with Cognito.",
};

/** Why signing in with Cognito came back to the sign-in page, by its ?error= value. */
export const providerErrors: Record<string, string> = {
  expired: "That sign-in took too long or was started elsewhere. Try again.",
  denied: "Cognito didn't sign you in. Try again.",
  "not-allowed": "That account isn't allowed on this Scout. Sign in with the address in DOSSIER_ALLOWED_EMAILS.",
  failed: "Signing in with Cognito didn't work. Try again; if it keeps failing, check the server's Cognito settings.",
  unavailable: "Cognito can't be reached right now. Try again in a moment.",
};
