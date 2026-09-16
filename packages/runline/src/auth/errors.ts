const messages = {
  invalid_definition: "Invalid authentication definition",
  invalid_credentials: "Missing or invalid authentication credentials",
  request_not_allowed: "Authenticated request is outside the approved policy",
  transport_failed:
    "Authenticated request failed; remote outcome may be unknown",
  response_too_large: "Authenticated response exceeds the configured limit",
  credential_store_failed:
    "Credential storage failed; provider outcome may be unknown",
  binding_changed: "Credential binding identity changed",
  unsupported_operation: "Authentication operation is not supported",
  invalid_response: "Invalid provider response",
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
