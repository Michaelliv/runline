import { basename } from "node:path";
import { type ActionContext, AuthError, type HttpMethod } from "runline";
import * as t from "typebox";
import { Check } from "typebox/value";
import { standardBase64 } from "../../_shared/base64.js";
import {
  credentialRequest,
  jsonAnswer,
  pathSegment,
  responseFailed,
} from "../../_shared/credentials.js";
import { readLocalFile } from "../../_shared/localFile.js";
import { obj } from "../../_shared/provider.js";
import { agentMailCredential } from "./credentials.js";
import { type attachment, id, MAX_REQUEST_BYTES } from "./schemas.js";

export function inboxPath(inboxId: string): string {
  return `inboxes/${pathSegment(inboxId)}`;
}
export function messagePath(inboxId: string, messageId: string): string {
  return `${inboxPath(inboxId)}/messages/${pathSegment(messageId)}`;
}
export function draftPath(inboxId: string, draftId: string): string {
  return `${inboxPath(inboxId)}/drafts/${pathSegment(draftId)}`;
}
export function threadPath(inboxId: string, threadId: string): string {
  return `${inboxPath(inboxId)}/threads/${pathSegment(threadId)}`;
}
export function attachmentPath(parent: string, attachmentId: string): string {
  return `${parent}/attachments/${pathSegment(attachmentId)}`;
}

// ─── Wire shape ──────────────────────────────────────────────────

const snake = (key: string) =>
  key === "query"
    ? "q"
    : key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Rename API fields, never user-owned maps (metadata or email headers). */
function wireFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [snake(key), value]),
  );
}

/** The bytes a request body can still hold once base64 inflates them by 4/3. */
const MAX_FILE_BYTES = Math.floor((MAX_REQUEST_BYTES * 3) / 4);

type AttachmentInput = t.Static<typeof attachment>;

function base64Content(value: string, index: number): string {
  const content = standardBase64(value);
  if (content === undefined)
    throw new Error(
      `agentMail: attachment ${index} contentBase64 is not valid base64`,
    );
  return content;
}

/** One attachment's base64 bytes, or its URL for AgentMail to fetch. */
async function attachmentSource(
  input: AttachmentInput,
  index: number,
): Promise<{ content: string } | { url: string }> {
  if ("contentBase64" in input) {
    const value = input.contentBase64;
    return {
      content: base64Content(
        typeof value === "string" ? value : value.contentBase64,
        index,
      ),
    };
  }
  if ("contentPath" in input) {
    const bytes = await readLocalFile(input.contentPath, {
      subject: `agentMail: attachment ${index} contentPath`,
      maxBytes: MAX_FILE_BYTES,
      oversize: `agentMail: attachment ${index} exceeds the 6 MB request limit once encoded; use url`,
    });
    return { content: bytes.toString("base64") };
  }
  if ("content" in input)
    return { content: Buffer.from(input.content, "utf8").toString("base64") };
  try {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
  } catch {
    throw new Error(
      `agentMail: attachment ${index} url requires HTTPS without embedded credentials`,
    );
  }
  return { url: input.url };
}

/**
 * One attachment as AgentMail's SendAttachment. A download result passed
 * as contentBase64 supplies the name and type the input leaves out; a
 * local file is named for its path; text defaults to text/plain.
 */
async function wireAttachment(
  input: AttachmentInput,
  index: number,
): Promise<Record<string, unknown>> {
  const source = await attachmentSource(input, index);
  if ("content" in source && !source.content)
    throw new Error(`agentMail: attachment ${index} is empty`);
  const result =
    "contentBase64" in input && typeof input.contentBase64 !== "string"
      ? input.contentBase64
      : undefined;
  return Object.fromEntries(
    Object.entries({
      filename:
        input.name ??
        (result?.name || undefined) ??
        ("contentPath" in input ? basename(input.contentPath) : undefined),
      content_type:
        input.mimeType ??
        (result?.mimeType || undefined) ??
        ("content" in input ? "text/plain" : undefined),
      content_disposition:
        input.inline === undefined
          ? undefined
          : input.inline
            ? "inline"
            : "attachment",
      content_id: input.contentId,
      ...source,
    }).filter(([, value]) => value !== undefined),
  );
}

const ATTACHMENT_KEYS = new Set(["attachments", "addAttachments"]);

async function wireBody(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(body).map(async ([key, value]) => [
      snake(key),
      ATTACHMENT_KEYS.has(key) && Array.isArray(value)
        ? await Promise.all(
            (value as AttachmentInput[]).map((item, index) =>
              wireAttachment(item, index),
            ),
          )
        : value,
    ]),
  );
  return Object.fromEntries(entries);
}

// ─── Requests ────────────────────────────────────────────────────

interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  target?: "api" | "send";
  idempotencyKey?: string;
}

interface Prepared {
  path: string;
  method: HttpMethod;
  target: "api" | "send";
  query?: Record<string, unknown>;
  body?: string;
  idempotencyKey?: string;
}

/** Everything that can be refused locally, before any IO. */
async function prepare(
  path: string,
  options: RequestOptions,
): Promise<Prepared> {
  const body =
    options.body === undefined
      ? undefined
      : JSON.stringify(await wireBody(options.body));
  if (body !== undefined && Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
    throw new Error(
      "agentMail: serialized request exceeds 6 MB; use URL-backed attachments",
    );
  return {
    path,
    method: options.method ?? "GET",
    target: options.target ?? "api",
    query: options.query ? wireFields(options.query) : undefined,
    body,
    idempotencyKey: options.idempotencyKey,
  };
}

/**
 * One request, no retries: sends and scheduled drafts have irreversible
 * effects. A failure carries AgentMail's stable error `code`
 * (`missing_permission`, `inbox_paused`, `idempotency_conflict`, …), the
 * field its docs say to branch on.
 */
async function dispatch(ctx: ActionContext, call: Prepared): Promise<unknown> {
  const response = await credentialRequest(ctx, agentMailCredential, {
    target: call.target,
    path: call.path,
    method: call.method,
    query: call.query,
    ...(call.body === undefined
      ? {}
      : { body: call.body, headers: { "Content-Type": "application/json" } }),
    ...(call.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: call.idempotencyKey }),
  });
  if (!response.ok)
    throw await responseFailed("agentMail", response, (body) => ({
      code: obj(body).code,
    }));
  return jsonAnswer(response);
}

export async function request(
  ctx: ActionContext,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return dispatch(ctx, await prepare(path, options));
}

const sendReceipt = t.Object({ message_id: id, thread_id: id });

/** Transport outcomes after which the provider may already have acted. */
const OUTCOME_UNKNOWN = new Set([
  "transport_failed",
  "response_too_large",
  "invalid_response",
  "credential_store_failed",
]);

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function outcomeUnknown(error: unknown): boolean {
  if (error instanceof AuthError) return OUTCOME_UNKNOWN.has(error.code);
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

/**
 * Every send posts once on the `send` target and requires a send receipt.
 * When the outcome is unknown — a 5xx, a lost connection, a malformed
 * receipt — the error says so and how to retry without a second delivery,
 * keeping its code and status for callers that branch on them.
 */
export async function sendMessage(
  ctx: ActionContext,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<t.Static<typeof sendReceipt>> {
  const call = await prepare(path, {
    method: "POST",
    body,
    target: "send",
    idempotencyKey,
  });
  try {
    const result = await dispatch(ctx, call);
    if (!Check(sendReceipt, result)) throw new AuthError("invalid_response");
    return result;
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    const hint = idempotencyKey
      ? "The email may have been sent; retry only with the same idempotencyKey and identical input."
      : "The email may have been sent; check message.list before resending, and pass idempotencyKey so a retry cannot deliver twice.";
    const wrapped: Error & { code?: string; status?: number } = new Error(
      `${error instanceof Error ? error.message : String(error)}. ${hint}`,
      { cause: error },
    );
    if (error instanceof AuthError) wrapped.code = error.code;
    const status = statusOf(error);
    if (status !== undefined) wrapped.status = status;
    throw wrapped;
  }
}
