import { obj, readBounded } from "../../_shared/provider.js";

/**
 * The requests that carry no stored credential: anonymous catalogue reads,
 * sent as the web app, and the owner login's steps, whose inputs come from
 * the person logging in. Everything signed goes through `authed` instead.
 */

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const WEB: Record<string, string> = {
  "user-agent": WEB_UA,
  "accept-language": "en",
  "app-language": "en",
  platform: "Web",
  "client-version": "1.16.125",
  origin: "https://wolt.com",
  referer: "https://wolt.com/",
};

/**
 * A failed request.
 *
 * The body stays private. Wolt puts meaningful data in its 4xx bodies — the
 * login escalation token, `error_code` — so the login flow needs to read it,
 * but those same bodies carry access and refresh tokens. `details()` is the
 * only way in, and the message never contains any of it.
 */
export class WoltError extends Error {
  readonly status: number;
  readonly endpoint: string;
  #body: string;

  constructor(status: number, endpoint: string, body: string) {
    const retired = status === 410 ? " (endpoint retired by Wolt)" : "";
    super(`wolt: request failed (HTTP ${status})${retired} on ${endpoint}`);
    this.name = "WoltError";
    this.status = status;
    this.endpoint = endpoint;
    this.#body = body;
  }

  /** The parsed body, for the branches that must read it. Never logged. */
  details(): Record<string, unknown> {
    try {
      return obj(JSON.parse(this.#body));
    } catch {
      return {};
    }
  }
}

export function endpointOf(host: string, path: string): string {
  return `${host}${path.split("?")[0]}`;
}

/**
 * An answer's body as an object. A failure keeps its body privately; Wolt
 * answers 200 with nothing at all on endpoints it has retired.
 */
export function answerOf(
  status: number,
  endpoint: string,
  text: string,
): Record<string, unknown> {
  if (status >= 400) throw new WoltError(status, endpoint, text);
  if (!text.trim())
    throw new Error(
      `wolt: ${endpoint} returned an empty body (endpoint retired)`,
    );
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new Error(`wolt: non-JSON response from ${endpoint}`);
  }
}

interface HttpOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Web persona for anonymous catalogue reads; mobile for the login. */
  web?: boolean;
}

/** One unsigned request; redirects are refused, as for every other call. */
export async function http(
  host: string,
  path: string,
  opts: HttpOptions = {},
): Promise<Record<string, unknown>> {
  const { method = "GET", body = null, headers = {}, web = true } = opts;
  const payload =
    body == null
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const merged: Record<string, string> = {
    ...(web ? WEB : {}),
    accept: "application/json",
    ...headers,
  };
  if (payload && !merged["content-type"])
    merged["content-type"] = "application/json";
  const endpoint = endpointOf(host, path);
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: merged,
    body: payload,
    redirect: "error",
  });
  const text = await readBounded(
    res,
    MAX_RESPONSE_BYTES,
    `wolt: response exceeded the size limit on ${endpoint}`,
  );
  return answerOf(res.status, endpoint, text);
}
