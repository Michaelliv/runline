import { type ActionContext, AuthError } from "runline";
import { readBounded } from "../../_shared/provider.js";
import { appHeaders, HOST } from "./credentials.js";
import { bodyOf, endpointOf } from "./shared.js";

/**
 * The owner login runs only where the grant lives: in this process, with a
 * connection it can write. Under a host that keeps the grant, setup is the
 * host's, and every login step refuses before any request.
 */
export function refuseUnderHost(ctx: ActionContext): void {
  if (ctx.credentials) throw new AuthError("unsupported_operation");
}

/**
 * One unsigned login call. It carries no stored credential — the phone, the
 * texted code and the card digits come from the person logging in — and its
 * answer may carry the tokens the login then stores.
 */
export async function loginRequest(
  ctx: ActionContext,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  refuseUnderHost(ctx);
  const res = await fetch(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      ...appHeaders(ctx.connection.config),
      accept: "application/json",
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
    redirect: "error",
  });
  const text = await readBounded(
    res,
    4 * 1024 * 1024,
    `gett: response exceeded the size limit on ${endpointOf(path)}`,
  );
  return bodyOf(new Response(text, { status: res.status }), path);
}
