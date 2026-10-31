import { execFile } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { AuthError } from "../auth/errors.js";
import { sendResource } from "./http.js";
import { secret } from "./policy.js";
import { signSigV4 } from "./sigv4.js";
import type { AwsAccessKey, AwsRole, AwsSession } from "./types.js";

/**
 * AWS endpoints, roles and responses: what SigV4 methods sign for, and
 * how a role session is issued. The signature itself is sigv4.ts.
 */

/** A region code: `us-east-1`, `eu-central-2`, `us-gov-west-1`, `cn-north-1`. */
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
/** A service's endpoint prefix: `ec2`, `ssm`, `logs`, `monitoring`. */
const SERVICE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A region from public config; anything else would sign for the wrong place. */
export function awsRegion(value: unknown): string {
  if (typeof value !== "string" || !REGION.test(value))
    throw new AuthError("invalid_credentials");
  return value;
}

/** Whether a target's signing scope names a well-formed service and region. */
export function isAwsScope(value: unknown): boolean {
  const scope = value as { service?: unknown; region?: unknown } | undefined;
  return (
    !!scope &&
    typeof scope.service === "string" &&
    SERVICE.test(scope.service) &&
    typeof scope.region === "string" &&
    REGION.test(scope.region)
  );
}

/**
 * The regional HTTPS endpoint of `service`: `https://<service>.<region>.
 * amazonaws.com/`, or `.amazonaws.com.cn` in the China partition.
 */
export function awsEndpoint(service: string, region: string): string {
  if (!SERVICE.test(service)) throw new AuthError("invalid_definition");
  const domain = awsRegion(region).startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `https://${service}.${region}.${domain}/`;
}

/**
 * An access key that can sign: an ID and a session token that go into
 * headers as they are (`secret`), and a secret that only keys the
 * signature. Anything else is refused before any request.
 */
export function awsAccessKey(value: unknown): AwsAccessKey {
  const key = value as Partial<AwsAccessKey> | undefined;
  if (typeof key?.secretAccessKey !== "string" || !key.secretAccessKey)
    throw new AuthError("invalid_credentials");
  return {
    accessKeyId: secret(key.accessKeyId),
    secretAccessKey: key.secretAccessKey,
    ...(key.sessionToken === undefined
      ? {}
      : { sessionToken: secret(key.sessionToken) }),
  };
}

/** An AWS CLI profile name, as `~/.aws/config` section names allow it. */
const PROFILE = /^[\w+=,.@-]{1,64}$/;

/** A profile name from config; anything else is refused before the CLI runs. */
export function awsProfileName(value: unknown): string {
  if (typeof value !== "string" || !PROFILE.test(value))
    throw new AuthError("invalid_credentials");
  return value;
}

/** A profile's key is used until this long before it expires. */
const PROFILE_KEY_MARGIN_MS = 5 * 60_000;

interface ProfileKey {
  key: AwsAccessKey;
  expiresAt: number | undefined;
}

/**
 * Each profile's key as this process holds it: settled while it lasts,
 * or still in flight, so concurrent callers share one CLI run.
 */
const profileKeys = new Map<string, Promise<ProfileKey>>();

/** A key a provider issued: one that cannot sign is a malformed answer. */
function issuedKey(value: unknown): AwsAccessKey {
  try {
    return awsAccessKey(value);
  } catch {
    throw new AuthError("invalid_response");
  }
}

/**
 * Why the CLI produced no key: it is not installed, it ran out of time,
 * it answered more than a key, or it refused (no login, or an expired
 * SSO session, which `aws sso login` mends).
 */
function cliFailure(error: { code?: unknown; killed?: boolean }): AuthError {
  if (error.code === "ENOENT") return new AuthError("invalid_credentials");
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return new AuthError("invalid_response");
  if (error.killed) return new AuthError("request_failed");
  return new AuthError("reconnect_required");
}

/** One CLI run: the profile's key, as `credential_process` defines it. */
async function exportProfileKey(profile: string): Promise<ProfileKey> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "aws",
      [
        "configure",
        "export-credentials",
        "--profile",
        profile,
        "--format",
        "process",
      ],
      { timeout: 30_000, maxBuffer: 64 * 1024 },
      (error, out) => (error ? reject(cliFailure(error)) : resolve(out)),
    );
  });
  let exported: Record<string, unknown>;
  try {
    exported = JSON.parse(stdout);
  } catch {
    throw new AuthError("invalid_response");
  }
  const expiresAt =
    exported.Expiration === undefined
      ? undefined
      : Date.parse(String(exported.Expiration));
  if (
    exported.Version !== 1 ||
    (expiresAt !== undefined && !Number.isSafeInteger(expiresAt))
  )
    throw new AuthError("invalid_response");
  return {
    key: issuedKey({
      accessKeyId: exported.AccessKeyId,
      secretAccessKey: exported.SecretAccessKey,
      ...(exported.SessionToken === undefined
        ? {}
        : { sessionToken: exported.SessionToken }),
    }),
    expiresAt,
  };
}

/**
 * The access key of an AWS CLI profile, as the CLI resolves it: an SSO
 * login, an assumed role, or a key in `~/.aws/credentials`, through
 * `aws configure export-credentials` (the `credential_process` contract).
 * Held until five minutes before it expires; however many callers find
 * it missing or stale, one CLI run serves them all, and a failed run is
 * not held.
 */
export async function awsProfileKey(name: string): Promise<AwsAccessKey> {
  const profile = awsProfileName(name);
  for (;;) {
    const held = profileKeys.get(profile);
    if (!held) break;
    const { key, expiresAt } = await held;
    if (
      expiresAt === undefined ||
      expiresAt > Date.now() + PROFILE_KEY_MARGIN_MS
    )
      return key;
    // Stale: refresh it, unless another caller already started to.
    if (profileKeys.get(profile) === held) break;
  }
  const exporting = exportProfileKey(profile);
  profileKeys.set(profile, exporting);
  exporting.catch(() => {
    if (profileKeys.get(profile) === exporting) profileKeys.delete(profile);
  });
  return (await exporting).key;
}

/** `arn:<partition>:iam::<account>:role/<path/name>`, as IAM allows it. */
const ROLE_ARN = /^arn:aws(?:-[a-z]+)*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;
const SESSION_NAME = /^[\w+=,.@-]{2,64}$/;
const EXTERNAL_ID = /^[\w+=,.@:/-]{2,1224}$/;

/** A role as STS accepts it; anything else is refused before any request. */
export function awsRole(role: AwsRole): AwsRole {
  if (
    !ROLE_ARN.test(role.roleArn) ||
    !SESSION_NAME.test(role.sessionName) ||
    (role.externalId !== undefined && !EXTERNAL_ID.test(role.externalId)) ||
    (role.durationSeconds !== undefined &&
      (!Number.isInteger(role.durationSeconds) ||
        role.durationSeconds < 900 ||
        role.durationSeconds > 43_200))
  )
    throw new AuthError("invalid_credentials");
  return { ...role, region: awsRegion(role.region) };
}

const xml = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  // Values stay strings: an account ID or a volume size is not ours to coerce.
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
});

/**
 * An AWS XML answer as plain data. Element text is a string; lists are
 * `item` or `member` entries. AWS sends no document type, and one that
 * declares entities could expand without bound, so a DOCTYPE is refused.
 */
export function parseAwsXml(text: string): Record<string, unknown> {
  if (/<!DOCTYPE/i.test(text)) throw new AuthError("invalid_response");
  try {
    const parsed: unknown = xml.parse(text, true);
    if (!parsed || typeof parsed !== "object") throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new AuthError("invalid_response");
  }
}

/**
 * An AWS error's code, from any of its envelopes: a JSON `__type`
 * (`com.amazonaws.ssm#InvalidInstanceId` → `InvalidInstanceId`) or `code`,
 * a query `ErrorResponse`, or EC2's `Response.Errors`. Undefined when the
 * body names none.
 */
export function awsErrorCode(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const body = JSON.parse(trimmed) as Record<string, unknown>;
      const code = body.__type ?? body.code ?? body.Code;
      return typeof code === "string" ? code.split("#").pop() : undefined;
    } catch {
      return undefined;
    }
  }
  if (!trimmed.startsWith("<")) return undefined;
  try {
    const body = parseAwsXml(trimmed);
    const envelope = (body.ErrorResponse ?? body.Response) as
      | Record<string, unknown>
      | undefined;
    const error = (envelope?.Error ??
      (envelope?.Errors as Record<string, unknown> | undefined)?.Error) as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | undefined;
    const first = Array.isArray(error) ? error[0] : error;
    return typeof first?.Code === "string" ? first.Code : undefined;
  } catch {
    return undefined;
  }
}

/** STS codes that mean the signing key itself is unusable: a reconnect, not a retry. */
const REJECTED_KEY = new Set([
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
  "ExpiredToken",
  "InvalidAccessKeyId",
  "UnrecognizedClientException",
]);

export interface AssumeRoleOptions {
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}

/**
 * A new session for `role`, requested from STS with `key`. A refused
 * key is reconnect_required; any other refusal (no permission to assume
 * the role, a trust policy mismatch) is provider_rejected.
 */
export async function assumeAwsRole(
  key: AwsAccessKey,
  role: AwsRole,
  options: AssumeRoleOptions,
): Promise<Omit<AwsSession, "revision">> {
  const signing = awsAccessKey(key);
  const valid = awsRole(role);
  const endpoint = new URL(awsEndpoint("sts", valid.region));
  const body = Buffer.from(
    new URLSearchParams({
      Action: "AssumeRole",
      Version: "2011-06-15",
      RoleArn: valid.roleArn,
      RoleSessionName: valid.sessionName,
      ...(valid.externalId === undefined
        ? {}
        : { ExternalId: valid.externalId }),
      ...(valid.durationSeconds === undefined
        ? {}
        : { DurationSeconds: String(valid.durationSeconds) }),
    }).toString(),
  );
  const contentType = "application/x-www-form-urlencoded; charset=utf-8";
  const now = Date.now();
  const signed = signSigV4(
    {
      method: "POST",
      host: endpoint.host,
      path: endpoint.pathname,
      query: [],
      headers: [["content-type", contentType]],
      body,
    },
    signing,
    { service: "sts", region: valid.region },
    new Date(now),
  );
  let response: Response;
  try {
    response = await sendResource(
      endpoint.toString(),
      "POST",
      new Headers({ "content-type": contentType, ...signed }),
      body,
      {
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: 64 * 1024,
      },
    );
  } catch {
    throw new AuthError("request_failed");
  }
  const text = await response.text();
  if (!response.ok) {
    const code = awsErrorCode(text);
    throw new AuthError(
      code && REJECTED_KEY.has(code)
        ? "reconnect_required"
        : "provider_rejected",
      response.status,
    );
  }
  const result = (
    parseAwsXml(text).AssumeRoleResponse as
      | { AssumeRoleResult?: { Credentials?: Record<string, unknown> } }
      | undefined
  )?.AssumeRoleResult?.Credentials;
  const expiresAt = Date.parse(String(result?.Expiration));
  if (
    typeof result?.SessionToken !== "string" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now
  )
    throw new AuthError("invalid_response");
  const session = issuedKey({
    accessKeyId: result.AccessKeyId,
    secretAccessKey: result.SecretAccessKey,
    sessionToken: result.SessionToken,
  });
  return {
    accessKeyId: session.accessKeyId,
    secretAccessKey: session.secretAccessKey,
    sessionToken: result.SessionToken,
    expiresAt,
  };
}
