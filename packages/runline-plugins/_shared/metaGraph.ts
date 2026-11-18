/**
 * A Graph API answer without Meta access tokens. A Page object carries
 * its own token as `access_token`, whether asked for or as part of its
 * default fields, and a request that sends its token in the query gets it
 * back in every paging link. Neither may reach an action's result.
 */
export function withoutAccessTokens(value: unknown): unknown {
  if (typeof value === "string")
    return value.includes("access_token=")
      ? value.replace(/([?&])access_token=[^&#]*&?/g, "$1").replace(/[?&]$/, "")
      : value;
  if (Array.isArray(value)) return value.map(withoutAccessTokens);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "access_token")
      .map(([key, entry]) => [key, withoutAccessTokens(entry)]),
  );
}
