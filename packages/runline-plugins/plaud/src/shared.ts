import {
  type ActionContext,
  AuthError,
  type CredentialType,
  downloadResource,
  type OAuth2Definition,
  OAuthGrantSchema,
} from "runline";
import * as t from "typebox";
import { credentialRuntime } from "../../_shared/credentialAdapter.js";

const BASE = "https://platform.plaud.ai/developer/api";

/** Public client identifier and fixed callback published in Plaud's official CLI. */
export const PLAUD_PUBLIC_CLIENT_ID =
  "client_f9e0b214-c11f-434b-8b95-c4497d1feb81";
export const PLAUD_REDIRECT_URI = "http://localhost:8199/auth/callback";

/** Third-party personal-recording API, NOT Plaud Embedded's partner-token API. */
export const PLAUD_OAUTH: OAuth2Definition = {
  id: "plaud.oauth2",
  provider: "plaud",
  authorization: { url: "https://web.plaud.ai/platform/oauth" },
  exchange: {
    url: `${BASE}/oauth/third-party/access-token`,
    clientAuthentication: "client_id_basic",
    grantType: null,
    sendState: true,
    requirePkce: true,
  },
  refresh: {
    url: `${BASE}/oauth/third-party/access-token/refresh`,
    clientAuthentication: "none",
    grantType: null,
  },
};

export const PLAUD_CREDENTIAL: CredentialType = {
  id: "plaud",
  methods: {
    oauth2: {
      schema: t.Object(
        { grant: t.Optional(OAuthGrantSchema) },
        { additionalProperties: false },
      ),
      authentication: {
        kind: "oauth2",
        grantField: "grant",
        definition: PLAUD_OAUTH,
        renewal: "refresh",
      },
      targets: {
        api: { baseUrl: `${BASE}/open/third-party/`, methods: ["GET"] },
      },
      probe: {
        target: "api",
        path: "users/current",
        method: "GET",
        acceptedStatuses: [200],
      },
    },
  },
};

export function plaudRuntime(ctx: ActionContext) {
  return credentialRuntime(ctx, PLAUD_CREDENTIAL, "oauth2", (config) => [
    config.clientId,
  ]);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthError("invalid_response");
  return value as Record<string, unknown>;
}

export async function request(
  ctx: ActionContext,
  path: string,
): Promise<Record<string, unknown>> {
  const { binding, transport } = plaudRuntime(ctx);
  const response = await transport.request(binding, { target: "api", path });
  if (!response.ok)
    throw new Error(`plaud: request failed (HTTP ${response.status})`);
  try {
    return object(await response.json());
  } catch {
    throw new AuthError("invalid_response");
  }
}

export async function recording(ctx: ActionContext, id: string) {
  // Encoding protects separators/query injection; the transport also rejects traversal.
  return request(ctx, `files/${encodeURIComponent(id)}`);
}

export async function list(ctx: ActionContext, page: number, pageSize: number) {
  const result = await request(
    ctx,
    `files/?${new URLSearchParams({ page: String(page), page_size: String(pageSize) })}`,
  );
  if (!Array.isArray(result.data) || result.data.length > pageSize)
    throw new AuthError("invalid_response");
  const data = result.data.map(object);
  return { ...result, data };
}

export function blocks(
  file: Record<string, unknown>,
  field: "source_list" | "note_list",
) {
  const value = file[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AuthError("invalid_response");
  return value.map(object);
}

/** Linked content is a separate, unauthenticated capability approved by host config. */
export async function blockContent(
  ctx: ActionContext,
  block: Record<string, unknown> | undefined,
) {
  if (!block) return { status: "unavailable" as const, content: null };
  if (typeof block.data_content === "string" && block.data_content.length)
    return { status: "available" as const, content: block.data_content };
  const link = block.data_link;
  if (typeof link !== "string" || !link)
    return { status: "unavailable" as const, content: null };
  const origins = ctx.connection.config.contentOrigins ?? [];
  if (
    !Array.isArray(origins) ||
    origins.some((origin) => {
      if (typeof origin !== "string") return true;
      try {
        const url = new URL(origin);
        return url.protocol !== "https:" || url.origin !== origin;
      } catch {
        return true;
      }
    })
  )
    throw new AuthError("invalid_credentials");
  let origin: string;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error();
    origin = url.origin;
  } catch {
    throw new AuthError("request_not_allowed");
  }
  if (!origins.includes(origin))
    return {
      status: "link_requires_approval" as const,
      content: null,
      contentUrl: link,
    };
  const response = await downloadResource(link, {
    allowedOrigins: [...origins],
    fetch: globalThis.fetch,
    maxResponseBytes: 8 * 1024 * 1024,
  });
  if (!response.ok)
    throw new Error(`plaud: content download failed (HTTP ${response.status})`);
  const content = await response.text();
  return {
    status: content ? ("available" as const) : ("unavailable" as const),
    content: content || null,
  };
}

function utcDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
    ? ms
    : undefined;
}

/** Timezone-less timestamps are UTC; invalid calendar days/times are not normalized. */
function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const [, day, hour, minute, second = "00", fraction = "", zone = "Z"] = match;
  const midnight = utcDay(day);
  if (midnight === undefined || hour === undefined) return midnight;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)
    return undefined;
  const result = Date.parse(
    `${day}T${hour}:${minute}:${second}${fraction}${zone}`,
  );
  return Number.isFinite(result) ? result : undefined;
}

export function dateBoundary(
  value: string | undefined,
  end: boolean,
): number | undefined {
  if (value === undefined) return undefined;
  const ms = utcDay(value);
  if (ms === undefined) throw new Error("plaud: invalid date; use YYYY-MM-DD");
  return ms + (end ? 86_400_000 - 1 : 0);
}

export async function scan(
  ctx: ActionContext,
  options: {
    query?: string;
    from?: number;
    to?: number;
    limit: number;
    maxPages: number;
  },
) {
  if (
    options.from !== undefined &&
    options.to !== undefined &&
    options.from > options.to
  )
    throw new Error("plaud: from must not be after to");
  const recordings: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const query = options.query?.toLowerCase();
  let scanned = 0;
  let pagesScanned = 0;
  for (let page = 1; page <= options.maxPages; page++) {
    const result = await list(ctx, page, 100);
    pagesScanned++;
    for (let index = 0; index < result.data.length; index++) {
      const file = result.data[index];
      scanned++;
      if (typeof file.id !== "string" || !file.id)
        throw new AuthError("invalid_response");
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      if (
        query &&
        !(
          typeof file.name === "string" &&
          file.name.toLowerCase().includes(query)
        )
      )
        continue;
      if (options.from !== undefined || options.to !== undefined) {
        const created = timestamp(file.created_at);
        if (
          created === undefined ||
          (options.from !== undefined && created < options.from) ||
          (options.to !== undefined && created > options.to)
        )
          continue;
      }
      recordings.push(file);
      if (recordings.length >= options.limit)
        return {
          recordings,
          scanned,
          pagesScanned,
          truncated:
            index < result.data.length - 1 || result.data.length === 100,
        };
    }
    if (result.data.length < 100)
      return { recordings, scanned, pagesScanned, truncated: false };
  }
  // Do not claim exhaustive results or assume provider ordering beyond the scanned pages.
  return { recordings, scanned, pagesScanned, truncated: true };
}
