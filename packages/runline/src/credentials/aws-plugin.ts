/**
 * The plugin side of AWS: one declaration for an AWS connection — an
 * access key, or a role it assumes — and the request paths of the AWS
 * protocols, all signed through the declared credential.
 */

import * as t from "typebox";
import { AuthError } from "../auth/errors.js";
import type { ActionContext } from "../plugin/types.js";
import { awsEndpoint, awsErrorCode, awsRole, parseAwsXml } from "./aws.js";
import {
  credentialRequest,
  errorIdentifier,
  failureMessage,
  jsonAnswer,
} from "./plugin.js";
import { AwsAccessKeySchema, AwsSessionSchema } from "./registry.js";
import type {
  CredentialDeclaration,
  CredentialProbe,
  CredentialTarget,
  HttpMethod,
} from "./types.js";

const STRICT = { additionalProperties: false } as const;

/**
 * An AWS endpoint as a declared target: the service's regional HTTPS
 * endpoint, signed for that service and region. `X-Amz-Target`, which
 * names the operation of a JSON-protocol call, is always allowed.
 */
export function awsTarget(
  service: string,
  region: string,
  options: {
    methods?: HttpMethod[];
    allowedHeaders?: string[];
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
): CredentialTarget {
  // The endpoint refuses a malformed service or region, so the scope is sound.
  return {
    baseUrl: awsEndpoint(service, region),
    methods: options.methods ?? ["GET", "POST"],
    allowedHeaders: ["X-Amz-Target", ...(options.allowedHeaders ?? [])],
    aws: { service, region },
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.maxResponseBytes !== undefined
      ? { maxResponseBytes: options.maxResponseBytes }
      : {}),
  };
}

export interface AwsCredentialSpec {
  /** Credential type id; one per provider family, shared by its plugins. */
  id: string;
  /** The endpoints the plugin calls (`awsTarget`), from public config. */
  targets: (
    config: Readonly<Record<string, unknown>>,
  ) => Record<string, CredentialTarget>;
  probe?: CredentialProbe;
}

/** A whole number from config, which a CLI or environment gives as a string. */
function configInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number))
    throw new AuthError("invalid_credentials");
  return number;
}

function configString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new AuthError("invalid_credentials");
  return value;
}

/**
 * An AWS connection's declaration. The access key — `accessKeyId`,
 * `secretAccessKey`, and a session's `sessionToken` — is the secret; the
 * rest is public config:
 *
 * - `roleArn` selects `assumeRole`: the key only assumes the role, and
 *   requests sign with its sessions, renewed before they expire. Without
 *   it, `accessKey` signs with the key itself.
 * - `roleSessionName` (default `runline`), `roleExternalId` and
 *   `roleDurationSeconds` shape each session request.
 * - `stsRegion`, else `region`, else `us-east-1`, is where sessions are
 *   requested.
 * - `awsProfile` names an AWS CLI profile (an SSO login) whose key this
 *   process signs with in place of a stored one; a host that stores the
 *   key ignores it.
 */
export function awsCredential(spec: AwsCredentialSpec): CredentialDeclaration {
  const key = { credential: AwsAccessKeySchema };
  const localSecret = {
    accessKeyId: { field: "accessKeyId" },
    secretAccessKey: { field: "secretAccessKey" },
    sessionToken: { field: "sessionToken" },
  };
  return (config) => {
    const targets = spec.targets(config);
    const probe = spec.probe ? { probe: spec.probe } : {};
    const awsProfile = configString(config.awsProfile);
    const roleArn = configString(config.roleArn);
    const externalId = configString(config.roleExternalId);
    const durationSeconds = configInteger(config.roleDurationSeconds);
    return {
      type: {
        id: spec.id,
        methods: {
          accessKey: {
            schema: t.Object(key, STRICT),
            authentication: { kind: "awsSigV4", field: "credential" },
            targets,
            ...probe,
          },
          assumeRole: {
            schema: t.Object(
              { ...key, session: t.Optional(AwsSessionSchema) },
              STRICT,
            ),
            authentication: {
              kind: "awsSigV4",
              field: "credential",
              assumeRole: { sessionField: "session" },
            },
            targets,
            ...probe,
          },
        },
      },
      ...(awsProfile === undefined ? { localSecret } : { awsProfile }),
      ...(roleArn === undefined
        ? { method: "accessKey" }
        : {
            method: "assumeRole",
            awsRole: awsRole({
              roleArn,
              sessionName: configString(config.roleSessionName) ?? "runline",
              ...(externalId === undefined ? {} : { externalId }),
              ...(durationSeconds === undefined ? {} : { durationSeconds }),
              region:
                configString(config.stsRegion) ??
                configString(config.region) ??
                "us-east-1",
            }),
          }),
    };
  };
}

/**
 * A failed AWS response by its status and the AWS error code it names
 * (`AccessDeniedException`, `InvalidInstanceId.NotFound`). The message
 * AWS sends with it, which can quote request data, never reaches the
 * error. The status and code ride on the error for callers that branch.
 */
export async function awsFailed(
  plugin: string,
  response: Response,
): Promise<Error & { status: number; code?: string }> {
  const code = errorIdentifier(awsErrorCode(await response.text()));
  return Object.assign(
    new Error(failureMessage(plugin, response.status, { code })),
    { status: response.status, ...(code ? { code } : {}) },
  );
}

/**
 * One call of an AWS JSON-protocol service (SSM, CloudWatch Logs,
 * Secrets Manager, CloudWatch): `operation` is the full
 * `X-Amz-Target`, e.g. `AmazonSSM.SendCommand`; `version` is the
 * service's JSON protocol version.
 */
export async function awsJson<T = unknown>(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  call: {
    target: string;
    operation: string;
    version: "1.0" | "1.1";
    input?: unknown;
  },
): Promise<T> {
  const response = await credentialRequest(ctx, declaration, {
    target: call.target,
    path: "",
    method: "POST",
    headers: {
      "Content-Type": `application/x-amz-json-${call.version}`,
      "X-Amz-Target": call.operation,
    },
    body: JSON.stringify(call.input ?? {}),
  });
  if (!response.ok) throw await awsFailed(plugin, response);
  return jsonAnswer<T>(response);
}

/**
 * One call of an AWS Query-protocol service (EC2, STS): the action's
 * parameters as the API names them, lists already numbered
 * (`Filter.1.Name`). Answers the `<Action>Response` element as data;
 * `awsList` reads its lists.
 */
export async function awsQuery(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  call: {
    target: string;
    action: string;
    version: string;
    params?: Record<string, string | number | boolean | undefined>;
  },
): Promise<Record<string, unknown>> {
  const response = await credentialRequest(ctx, declaration, {
    target: call.target,
    path: "",
    method: "POST",
    headers: { Accept: "text/xml" },
    form: { Action: call.action, Version: call.version, ...call.params },
  });
  if (!response.ok) throw await awsFailed(plugin, response);
  const answer = parseAwsXml(await response.text())[`${call.action}Response`];
  if (!answer || typeof answer !== "object")
    throw new AuthError("invalid_response");
  return answer as Record<string, unknown>;
}

/**
 * The entries of an AWS XML list: EC2's `<item>` and the query
 * services' `<member>` elements, one or many, and none for an empty or
 * absent list.
 */
export function awsList(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const holder = value as Record<string, unknown>;
  const entries = holder.item ?? holder.member;
  if (entries === undefined || entries === "") return [];
  return Array.isArray(entries) ? entries : [entries];
}
