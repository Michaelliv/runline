import type { ActionContext } from "runline";
import { refuseUnderHost } from "../../_shared/credentials.js";
import { readBounded } from "../../_shared/provider.js";
import { appHeaders, HOST } from "./credentials.js";
import { bodyOf, endpointOf } from "./shared.js";

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
