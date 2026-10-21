import type { ActionContext } from "runline";
import {
  answerFailed,
  credentialRequest,
  failureMessage,
  jsonAnswer,
  requestFailed,
} from "../../_shared/credentials.js";
import { fxmacrodataCredential } from "./credentials.js";

export const NAME = "fxmacrodata";

/** The API's own ceiling on one page. */
export const MAX_LIMIT = 100;

/** How many pages one call follows before it stops and says so. */
export const MAX_PAGES = 50;

const SUBSCRIBE_URL = "https://fxmacrodata.com/subscribe";

export type Answer = Record<string, unknown>;

/** A caller mistake, named for the field at fault. */
export function invalidInput(field: string, rule: string): Error {
  return new Error(`${NAME}: invalid ${field}: ${rule}`);
}

/** An answer that is not the documented shape. */
export function invalidAnswer(detail: string): Error {
  return new Error(`${NAME}: unexpected response: ${detail}`);
}

function isRecord(value: unknown): value is Answer {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Input ────────────────────────────────────────────

/** A three-letter currency code, lower-cased for the path. */
export function currencyCode(value: unknown, field = "currency"): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z]{3}$/.test(text))
    throw invalidInput(field, "expected a 3-letter code such as USD");
  return text.toLowerCase();
}

/** An indicator slug as listed by catalogue.get, e.g. `inflation`. */
export function indicatorSlug(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_]{1,80}$/.test(text))
    throw invalidInput("indicator", "expected a slug such as inflation");
  return text.toLowerCase();
}

/** A real calendar date as YYYY-MM-DD, or undefined when absent. */
export function calendarDate(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = match
    ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
    : undefined;
  if (!parsed || parsed.toISOString().slice(0, 10) !== text)
    throw invalidInput(field, "expected a real date as YYYY-MM-DD");
  return text;
}

/** Start and end dates, each optional, start no later than end. */
export function dateRange(input: Answer): Answer {
  const start = calendarDate(input.startDate, "startDate");
  const end = calendarDate(input.endDate, "endDate");
  if (start && end && start > end)
    throw invalidInput("startDate", "must not be after endDate");
  return { start_date: start, end_date: end };
}

/** A whole number within bounds, or `fallback` when absent. */
export function wholeNumber(
  value: unknown,
  field: string,
  bounds: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === null) return bounds.fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < bounds.min ||
    value > bounds.max
  )
    throw invalidInput(
      field,
      `expected a whole number from ${bounds.min} to ${bounds.max}`,
    );
  return value;
}

// ── Output ───────────────────────────────────────────

/**
 * The key this process signs with, when it holds one. A host broker keeps
 * the key itself, so there is nothing here to scrub.
 */
function heldKey(ctx: ActionContext): string | undefined {
  const key = ctx.connection.config.apiKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

/** Every string and object property name with the key replaced if echoed. */
export function scrubbed<T>(value: T, key: string | undefined): T {
  if (!key) return value;
  if (typeof value === "string")
    return value.split(key).join("[redacted]") as T;
  if (Array.isArray(value))
    return value.map((entry) => scrubbed(entry, key)) as T;
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        scrubbed(name, key),
        scrubbed(entry, key),
      ]),
    ) as T;
  return value;
}

/**
 * The free tier's own notes: the 90-day history window and the 15-minute
 * release delay. They are surfaced so a delayed or truncated answer is not
 * read as current and complete.
 */
export function noticesOf(answer: Answer): string[] {
  return ["freemium_window", "freemium_delay"].flatMap((field) => {
    const notice = answer[field];
    return isRecord(notice) &&
      notice.applied !== false &&
      typeof notice.message === "string" &&
      notice.message.trim()
      ? [notice.message.trim()]
      : [];
  });
}

// ── Requests ─────────────────────────────────────────

/** A 200 whose body reports an error rather than data. */
function failedAnswer(answer: Answer): Error | undefined {
  if (typeof answer.error !== "string") return undefined;
  return answerFailed(NAME, {
    code: answer.code ?? answer.error,
    message: answer.detail ?? answer.message,
  });
}

/**
 * One GET beneath the v1 base, through the credential broker (which
 * refuses redirects and never reads a failed body into the error). A
 * missing or rejected key reads as a pointer to where keys come from.
 */
export async function getAnswer(
  ctx: ActionContext,
  path: string,
  query: Answer = {},
): Promise<Answer> {
  const response = await credentialRequest(ctx, fxmacrodataCredential, {
    target: "api",
    path,
    query,
  });
  if (response.status === 401 || response.status === 403)
    throw new Error(
      `${failureMessage(NAME, response.status)}: this request needs an API key (${SUBSCRIBE_URL})`,
    );
  if (!response.ok) throw requestFailed(NAME, response.status);
  const answer = scrubbed(await jsonAnswer(response), heldKey(ctx));
  if (!isRecord(answer)) throw invalidAnswer("expected a JSON object");
  const failure = failedAnswer(answer);
  if (failure) throw failure;
  return answer;
}

/** The answer's `data` rows, which must be a list. */
export function rowsOf(answer: Answer): unknown[] {
  if (!Array.isArray(answer.data)) throw invalidAnswer("expected a data list");
  return answer.data;
}

/**
 * Where the next page starts, or undefined on the last page. A missing or
 * null `pagination` means one page; one that is present must be the
 * documented shape, and its next offset must move forward.
 */
export function nextOffset(answer: Answer, offset: number): number | undefined {
  const pagination = answer.pagination;
  if (pagination === undefined || pagination === null) return undefined;
  if (!isRecord(pagination)) throw invalidAnswer("pagination is not an object");
  const more = pagination.has_more;
  if (typeof more !== "boolean")
    throw invalidAnswer("pagination.has_more is not a boolean");
  if (!more) return undefined;
  const next = pagination.next_offset;
  if (typeof next !== "number" || !Number.isSafeInteger(next) || next <= offset)
    throw invalidAnswer("pagination.next_offset does not advance");
  return next;
}
