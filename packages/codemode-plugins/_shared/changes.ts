/**
 * What a failed change says about itself. A read that fails changed
 * nothing; a change that got no answer, or a 5xx, may have been applied,
 * and sending it again could apply it twice.
 */

const UNKNOWN_OUTCOME =
  "The change may have been applied: check before sending it again.";

/**
 * A change's request error, as thrown. One that never got an answer says
 * its outcome is unknown, keeping its code; any other is the error itself.
 */
export function unansweredChange(error: unknown): unknown {
  const code = (error as { code?: unknown }).code;
  if (code !== "transport_failed") return error;
  return Object.assign(
    new Error(`${(error as Error).message}. ${UNKNOWN_OUTCOME}`, {
      cause: error,
    }),
    { code },
  );
}

/** A change's failed response: a 5xx says its outcome is unknown. */
export function failedChange<E extends Error & { status: number }>(
  failure: E,
): E {
  if (failure.status >= 500) failure.message += `. ${UNKNOWN_OUTCOME}`;
  return failure;
}
