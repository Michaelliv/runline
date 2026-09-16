const messages = {
  invalid_definition: "Invalid authentication definition",
  invalid_credentials: "Missing or invalid authentication credentials",
  unsupported_operation: "Authentication operation is not supported",
  invalid_response: "Invalid OAuth token response",
  request_failed: "OAuth token request failed; provider outcome may be unknown",
  provider_rejected: "OAuth provider rejected the token request",
  reconnect_required: "OAuth grant is invalid; reconnect the account",
} as const;

export type AuthErrorCode = keyof typeof messages;

/** Safe to serialize. No raw response, endpoint URL, credential, or nested cause. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status?: number;

  constructor(code: AuthErrorCode, status?: number) {
    super(messages[code]);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
