/**
 * `fetch` for a request that carries a credential.
 *
 * Every plugin outside the credential registry hand-rolls its provider calls,
 * and a bare `fetch` follows redirects by default — which hands the
 * `Authorization` header to whatever host the response names. The registry's
 * own transport (`runline/src/credentials/http.ts`) refuses redirects for
 * exactly this reason; this is the same guarantee for the plugins that do not
 * go through it.
 *
 * Drop-in: same signature and same `Response` as `fetch`, so a call site
 * changes by one identifier and nothing downstream moves.
 *
 *   const res = await authedFetch(url, { headers: { Authorization: key } });
 */

/**
 * `redirect: "error"` makes fetch reject rather than follow. The
 * `response.redirected` and 3xx checks are belt to that brace: a runtime whose
 * fetch ignores the option, or a hook that replaces it, must not silently
 * reopen the hole.
 */
export async function authedFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(input, { ...init, redirect: "error" });
  const followed = response.redirected;
  const offered = response.status >= 300 && response.status < 400;
  if (followed || offered) {
    void response.body?.cancel().catch(() => {});
    throw new Error(
      followed
        ? "Refusing a request that followed a redirect while carrying credentials."
        : `Refusing a redirect on a request carrying credentials (HTTP ${response.status}).`,
    );
  }
  return response;
}
