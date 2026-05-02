/**
 * Google Calendar plugin for runline.
 *
 * Authentication mirrors the gmail plugin: OAuth2 user flow, seeded
 * once via `runline auth googleCalendar`. The connection stores
 * `clientId`, `clientSecret`, `refreshToken`, plus cached
 * `accessToken` + `accessTokenExpiresAt`. Token refresh is lazy —
 * when the cached token is missing or within 60 s of expiry the
 * plugin hits `https://oauth2.googleapis.com/token` and persists
 * the new token via `ctx.updateConnection`.
 *
 * Surface area:
 *
 *   calendar.list / calendar.get / calendar.availability   (freeBusy)
 *   calendar.listColors
 *
 *   event.create / event.get / event.list / event.update /
 *   event.delete / event.move / event.listInstances
 *
 * RRULE handling: callers can either supply a full `rrule` string
 * (e.g. `FREQ=WEEKLY;INTERVAL=2;COUNT=5`) or the decomposed
 * `repeatFrequency` / `repeatHowManyTimes` / `repeatUntil` fields,
 * and the plugin assembles a single `RRULE:…` line. `event.get`
 * and `event.list` attach a `nextOccurrence` field to recurring
 * events, computed locally via the `rrule` package so we don't
 * need a second API round-trip. Callers who want Google to expand
 * the series server-side can pass `singleEvents=true` on list, or
 * call `event.listInstances`.
 */

import rrulePkg from "rrule";
import type { ActionContext, RunlinePluginAPI } from "runline";
import { googleAccessToken } from "../../_shared/googleAuth.js";

// `rrule` ships as CJS; named imports fail under Node ESM.
const { RRule } = rrulePkg as unknown as { RRule: typeof import("rrule").RRule };

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleCalendarConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface Reminder {
  method: "email" | "popup";
  minutes: number;
}

interface ConferenceCreateRequest {
  createRequest: {
    requestId: string;
    conferenceSolutionKey: { type: string };
  };
}

interface EventBody {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  attendees?: Array<{ email: string }>;
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: Reminder[] };
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  transparency?: string;
  visibility?: string;
  conferenceData?: ConferenceCreateRequest;
}

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleCalendar", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://www.googleapis.com/calendar/v3";

async function calRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${API_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const entry of v) url.searchParams.append(k, String(entry));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    // 403/429 deserve a retry with exponential backoff — Calendar
    // hands these out freely when you hit per-user quota.
    throw new Error(`googleCalendar: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

async function paginateAll(
  ctx: Ctx,
  path: string,
  key: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = { ...qs, maxResults: 100 };
  do {
    const page = (await calRequest(ctx, "GET", path, undefined, query)) as {
      [k: string]: unknown;
      nextPageToken?: string;
    };
    const items = (page[key] as Record<string, unknown>[]) ?? [];
    out.push(...items);
    query.pageToken = page.nextPageToken;
  } while (query.pageToken);
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────

function encodeCalendarId(id: string): string {
  // Calendar IDs are email-shaped. Decode-then-encode tolerates
  // double-encoded input from upstream callers.
  return encodeURIComponent(decodeURIComponent(id));
}

function splitAttendees(input: unknown): Array<{ email: string }> | undefined {
  if (input === undefined || input === null) return undefined;
  const raw: string[] = Array.isArray(input)
    ? (input as string[])
    : String(input).split(",");
  const emails = raw
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (emails.length === 0) return undefined;
  return emails.map((email) => ({ email }));
}

function buildRecurrence(p: Record<string, unknown>): string[] | undefined {
  if (typeof p.rrule === "string" && p.rrule.length > 0) {
    const s = p.rrule.startsWith("RRULE:") ? p.rrule : `RRULE:${p.rrule}`;
    return [s];
  }
  const parts: string[] = [];
  if (p.repeatFrequency) {
    parts.push(`FREQ=${String(p.repeatFrequency).toUpperCase()}`);
  }
  if (p.repeatHowManyTimes !== undefined && p.repeatUntil !== undefined) {
    throw new Error(
      "googleCalendar: set either repeatHowManyTimes or repeatUntil, not both",
    );
  }
  if (p.repeatHowManyTimes !== undefined) {
    parts.push(`COUNT=${p.repeatHowManyTimes}`);
  }
  if (p.repeatUntil) {
    // Google wants UTC basic-format: YYYYMMDDTHHMMSSZ.
    const d = new Date(String(p.repeatUntil));
    if (Number.isNaN(d.getTime())) {
      throw new Error(`googleCalendar: invalid repeatUntil "${p.repeatUntil}"`);
    }
    const iso = d.toISOString(); // 2026-01-02T03:04:05.000Z
    const compact = iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    parts.push(`UNTIL=${compact}`);
  }
  if (parts.length === 0) return undefined;
  return [`RRULE:${parts.join(";")}`];
}

function buildEventTimes(
  start: unknown,
  end: unknown,
  allDay: boolean,
  timeZone?: string,
): { start: EventDateTime; end: EventDateTime } {
  if (allDay) {
    const fmt = (v: unknown) => {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new Error(`googleCalendar: invalid date "${v}"`);
      return d.toISOString().slice(0, 10);
    };
    return { start: { date: fmt(start) }, end: { date: fmt(end) } };
  }
  const toISO = (v: unknown) => {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new Error(`googleCalendar: invalid dateTime "${v}"`);
    return d.toISOString();
  };
  return {
    start: { dateTime: toISO(start), timeZone },
    end: { dateTime: toISO(end), timeZone },
  };
}

// ─── Next-occurrence resolution ─────────────────────────────────

interface RecurringEvent {
  id?: string;
  recurrence?: string[];
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  nextOccurrence?: {
    start: { dateTime: string; timeZone?: string };
    end: { dateTime: string; timeZone?: string };
  };
}

/**
 * For each recurring event in `items`, compute the next occurrence
 * after `now` by combining its own `start` (DTSTART) with the first
 * `RRULE:` line in `recurrence`, and stash it as `nextOccurrence`.
 *
 * Rules:
 *   • skip events whose RRULE has already ended (UNTIL in the past);
 *   • preserve the original duration on the computed next instance;
 *   • swallow per-event parse errors (warn, continue).
 */
function addNextOccurrence<T extends RecurringEvent>(items: T[]): T[] {
  const now = new Date();
  for (const item of items) {
    if (!item.recurrence) continue;
    const rule = item.recurrence.find((r) => r.toUpperCase().startsWith("RRULE"));
    if (!rule) continue;
    try {
      const startISO = item.start?.dateTime ?? item.start?.date;
      const endISO = item.end?.dateTime ?? item.end?.date;
      if (!startISO || !endISO) continue;
      const start = new Date(startISO);
      const end = new Date(endISO);
      const dtstart = `DTSTART:${start
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`;
      const rrule = RRule.fromString(`${dtstart}\n${rule}`);
      const until = rrule.options?.until;
      if (until && until < now) continue;
      const nextStart = rrule.after(now, false);
      if (!nextStart) continue;
      const duration = end.getTime() - start.getTime();
      const nextEnd = new Date(nextStart.getTime() + duration);
      item.nextOccurrence = {
        start: { dateTime: nextStart.toISOString(), timeZone: item.start?.timeZone },
        end: { dateTime: nextEnd.toISOString(), timeZone: item.end?.timeZone },
      };
    } catch (err) {
      console.warn(
        `googleCalendar: failed to resolve next occurrence for ${item.id}: ${(err as Error).message}`,
      );
    }
  }
  return items;
}

function uuid(): string {
  // Good enough for conferenceData.createRequest.requestId — Google
  // just wants a per-event unique string.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function applyEventFields(body: EventBody, p: Record<string, unknown>): void {
  if (typeof p.summary === "string") body.summary = p.summary;
  if (typeof p.description === "string") body.description = p.description;
  if (typeof p.location === "string") body.location = p.location;
  if (typeof p.colorId === "string") body.colorId = p.colorId;
  if (typeof p.id === "string") body.id = p.id;
  if (typeof p.transparency === "string") body.transparency = p.transparency;
  if (typeof p.visibility === "string") body.visibility = p.visibility;
  if (typeof p.guestsCanInviteOthers === "boolean")
    body.guestsCanInviteOthers = p.guestsCanInviteOthers;
  if (typeof p.guestsCanModify === "boolean") body.guestsCanModify = p.guestsCanModify;
  if (typeof p.guestsCanSeeOtherGuests === "boolean")
    body.guestsCanSeeOtherGuests = p.guestsCanSeeOtherGuests;

  const attendees = splitAttendees(p.attendees);
  if (attendees) body.attendees = attendees;

  if (p.reminders !== undefined || p.useDefaultReminders !== undefined) {
    const useDefault = p.useDefaultReminders !== false && !Array.isArray(p.reminders);
    body.reminders = { useDefault };
    if (Array.isArray(p.reminders)) {
      body.reminders.overrides = p.reminders as Reminder[];
    }
  }

  if (p.conferenceSolution) {
    body.conferenceData = {
      createRequest: {
        requestId: uuid(),
        conferenceSolutionKey: { type: String(p.conferenceSolution) },
      },
    };
  }
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export default function googleCalendar(rl: RunlinePluginAPI) {
  rl.setName("googleCalendar");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the Google Calendar API:",
      "     https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      "",
      "3. Configure the OAuth consent screen (first time only):",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: false,
      description: "Google OAuth2 client ID",
      env: "GOOGLE_CALENDAR_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "Google OAuth2 client secret",
      env: "GOOGLE_CALENDAR_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "OAuth2 refresh token (obtained via login flow)",
      env: "GOOGLE_CALENDAR_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      description: "Google service account JSON credential",
      env: "GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      description: "Google service account email",
      env: "GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      description: "Google service account private key",
      env: "GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      description: "User email to impersonate with domain-wide delegation",
      env: "GOOGLE_CALENDAR_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: {
      type: "string",
      required: false,
      description: "Cached access token (auto-refreshed)",
    },
    accessTokenExpiresAt: {
      type: "number",
      required: false,
      description: "Cached access token expiry (ms since epoch)",
    },
  });

  // ── Calendar ──────────────────────────────────────────

  rl.registerAction("calendar.list", {
    description: "List calendars the authenticated user has access to",
    inputSchema: {
      returnAll: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      showHidden: { type: "boolean", required: false },
      showDeleted: { type: "boolean", required: false },
      minAccessRole: {
        type: "string",
        required: false,
        description: "freeBusyReader | reader | writer | owner",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.showHidden) qs.showHidden = p.showHidden;
      if (p.showDeleted) qs.showDeleted = p.showDeleted;
      if (p.minAccessRole) qs.minAccessRole = p.minAccessRole;
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.returnAll) return paginateAll(ctx, "/users/me/calendarList", "items", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      return calRequest(ctx, "GET", "/users/me/calendarList", undefined, qs);
    },
  });

  rl.registerAction("calendar.get", {
    description: "Get a calendar's metadata (including conference solutions)",
    inputSchema: {
      calendarId: {
        type: "string",
        required: true,
        description: 'Calendar ID (email) or "primary"',
      },
    },
    async execute(input, ctx) {
      const { calendarId } = input as { calendarId: string };
      return calRequest(
        ctx,
        "GET",
        `/users/me/calendarList/${encodeCalendarId(calendarId)}`,
      );
    },
  });

  rl.registerAction("calendar.availability", {
    description:
      "Check free/busy information for one or more calendars over a time range",
    inputSchema: {
      calendarId: {
        type: "string",
        required: false,
        description: 'Single calendar ID (email) or "primary"',
      },
      calendarIds: {
        type: "array",
        required: false,
        description: "Multiple calendar IDs (takes precedence over calendarId)",
      },
      timeMin: {
        type: "string",
        required: true,
        description: "ISO datetime — start of the interval",
      },
      timeMax: {
        type: "string",
        required: true,
        description: "ISO datetime — end of the interval",
      },
      timeZone: { type: "string", required: false },
      outputFormat: {
        type: "string",
        required: false,
        description: "availability | bookedSlots | raw (default: raw)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const ids: string[] = Array.isArray(p.calendarIds)
        ? (p.calendarIds as string[])
        : p.calendarId
          ? [p.calendarId as string]
          : [];
      if (ids.length === 0) {
        throw new Error("googleCalendar: calendarId or calendarIds is required");
      }
      const body: Record<string, unknown> = {
        timeMin: new Date(String(p.timeMin)).toISOString(),
        timeMax: new Date(String(p.timeMax)).toISOString(),
        items: ids.map((id) => ({ id })),
      };
      if (p.timeZone) body.timeZone = p.timeZone;

      const res = (await calRequest(ctx, "POST", "/freeBusy", body)) as {
        calendars: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown }>;
      };

      const fmt = (p.outputFormat as string | undefined) ?? "raw";
      if (fmt === "raw") return res;
      if (ids.length === 1) {
        const entry = res.calendars?.[ids[0]];
        if (entry?.errors) {
          throw new Error(`googleCalendar: freeBusy error ${JSON.stringify(entry.errors)}`);
        }
        const busy = entry?.busy ?? [];
        if (fmt === "availability") return { available: busy.length === 0 };
        if (fmt === "bookedSlots") return busy;
      }
      // Multi-calendar: return a map per ID with the same shape as the single case.
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const entry = res.calendars?.[id];
        const busy = entry?.busy ?? [];
        if (fmt === "availability") out[id] = { available: busy.length === 0 };
        else if (fmt === "bookedSlots") out[id] = busy;
      }
      return out;
    },
  });

  rl.registerAction("calendar.listColors", {
    description: "List event and calendar color palettes available in Google Calendar",
    async execute(_input, ctx) {
      return calRequest(ctx, "GET", "/colors");
    },
  });

  // ── Event ─────────────────────────────────────────────

  rl.registerAction("event.create", {
    description: "Create a calendar event",
    inputSchema: {
      calendarId: { type: "string", required: true },
      summary: { type: "string", required: false },
      description: { type: "string", required: false },
      location: { type: "string", required: false },
      start: {
        type: "string",
        required: true,
        description: "ISO datetime (or YYYY-MM-DD when allDay)",
      },
      end: { type: "string", required: true },
      allDay: { type: "boolean", required: false },
      timeZone: { type: "string", required: false },
      attendees: {
        type: "array",
        required: false,
        description: "Array of email addresses, or a comma-separated string",
      },
      colorId: { type: "string", required: false },
      id: { type: "string", required: false, description: "Custom event ID" },
      transparency: {
        type: "string",
        required: false,
        description: 'Show me as: "opaque" (busy) | "transparent" (free)',
      },
      visibility: { type: "string", required: false },
      guestsCanInviteOthers: { type: "boolean", required: false },
      guestsCanModify: { type: "boolean", required: false },
      guestsCanSeeOtherGuests: { type: "boolean", required: false },
      reminders: {
        type: "array",
        required: false,
        description: '[{method: "email"|"popup", minutes: number}]',
      },
      useDefaultReminders: { type: "boolean", required: false },
      rrule: { type: "string", required: false, description: "e.g. FREQ=WEEKLY;COUNT=5" },
      repeatFrequency: {
        type: "string",
        required: false,
        description: "daily | weekly | monthly | yearly",
      },
      repeatHowManyTimes: { type: "number", required: false },
      repeatUntil: { type: "string", required: false, description: "ISO datetime" },
      conferenceSolution: {
        type: "string",
        required: false,
        description: "eventHangout | eventNamedHangout | hangoutsMeet",
      },
      sendUpdates: {
        type: "string",
        required: false,
        description: "all | externalOnly | none",
      },
      maxAttendees: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: EventBody = {};
      const times = buildEventTimes(
        p.start,
        p.end,
        p.allDay === true,
        p.timeZone as string | undefined,
      );
      body.start = times.start;
      body.end = times.end;
      applyEventFields(body, p);
      const recurrence = buildRecurrence(p);
      if (recurrence) body.recurrence = recurrence;

      const qs: Record<string, unknown> = {};
      if (p.sendUpdates) qs.sendUpdates = p.sendUpdates;
      if (p.maxAttendees) qs.maxAttendees = p.maxAttendees;
      if (body.conferenceData) qs.conferenceDataVersion = 1;

      return calRequest(
        ctx,
        "POST",
        `/calendars/${encodeCalendarId(p.calendarId as string)}/events`,
        body as unknown as Record<string, unknown>,
        qs,
      );
    },
  });

  rl.registerAction("event.get", {
    description: "Get a single event",
    inputSchema: {
      calendarId: { type: "string", required: true },
      eventId: { type: "string", required: true },
      timeZone: { type: "string", required: false },
      maxAttendees: { type: "number", required: false },
      nextOccurrence: {
        type: "boolean",
        required: false,
        description: "Attach nextOccurrence for recurring events (default: true)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.timeZone) qs.timeZone = p.timeZone;
      if (p.maxAttendees) qs.maxAttendees = p.maxAttendees;
      const res = (await calRequest(
        ctx,
        "GET",
        `/calendars/${encodeCalendarId(p.calendarId as string)}/events/${p.eventId}`,
        undefined,
        qs,
      )) as RecurringEvent;
      if (p.nextOccurrence !== false) addNextOccurrence([res]);
      return res;
    },
  });

  rl.registerAction("event.list", {
    description:
      "List events in a calendar. Set `singleEvents=true` to expand recurring events into instances.",
    inputSchema: {
      calendarId: { type: "string", required: true },
      q: { type: "string", required: false, description: "Free-text query" },
      timeMin: { type: "string", required: false, description: "ISO datetime" },
      timeMax: { type: "string", required: false },
      updatedMin: { type: "string", required: false },
      timeZone: { type: "string", required: false },
      iCalUID: { type: "string", required: false },
      orderBy: {
        type: "string",
        required: false,
        description: "startTime (requires singleEvents=true) | updated",
      },
      singleEvents: { type: "boolean", required: false },
      showDeleted: { type: "boolean", required: false },
      showHiddenInvitations: { type: "boolean", required: false },
      maxAttendees: { type: "number", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      returnAll: { type: "boolean", required: false },
      fields: { type: "string", required: false },
      nextOccurrence: {
        type: "boolean",
        required: false,
        description:
          "Attach nextOccurrence to recurring events (default: true; ignored when singleEvents=true)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      for (const k of [
        "q",
        "timeZone",
        "iCalUID",
        "orderBy",
        "singleEvents",
        "showDeleted",
        "showHiddenInvitations",
        "maxAttendees",
        "pageToken",
        "fields",
      ] as const) {
        if (p[k] !== undefined) qs[k] = p[k];
      }
      if (p.timeMin) qs.timeMin = new Date(String(p.timeMin)).toISOString();
      if (p.timeMax) qs.timeMax = new Date(String(p.timeMax)).toISOString();
      if (p.updatedMin) qs.updatedMin = new Date(String(p.updatedMin)).toISOString();

      const path = `/calendars/${encodeCalendarId(p.calendarId as string)}/events`;
      const attachNext = p.nextOccurrence !== false && p.singleEvents !== true;
      if (p.returnAll) {
        const items = (await paginateAll(ctx, path, "items", qs)) as RecurringEvent[];
        if (attachNext) addNextOccurrence(items);
        return items;
      }
      if (p.maxResults) qs.maxResults = p.maxResults;
      const res = (await calRequest(ctx, "GET", path, undefined, qs)) as {
        items?: RecurringEvent[];
      };
      if (attachNext && Array.isArray(res.items)) addNextOccurrence(res.items);
      return res;
    },
  });

  rl.registerAction("event.listInstances", {
    description: "List instances of a recurring event",
    inputSchema: {
      calendarId: { type: "string", required: true },
      eventId: { type: "string", required: true },
      timeMin: { type: "string", required: false },
      timeMax: { type: "string", required: false },
      timeZone: { type: "string", required: false },
      showDeleted: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      returnAll: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.timeMin) qs.timeMin = new Date(String(p.timeMin)).toISOString();
      if (p.timeMax) qs.timeMax = new Date(String(p.timeMax)).toISOString();
      if (p.timeZone) qs.timeZone = p.timeZone;
      if (p.showDeleted) qs.showDeleted = p.showDeleted;
      if (p.pageToken) qs.pageToken = p.pageToken;
      const path = `/calendars/${encodeCalendarId(
        p.calendarId as string,
      )}/events/${p.eventId}/instances`;
      if (p.returnAll) return paginateAll(ctx, path, "items", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      return calRequest(ctx, "GET", path, undefined, qs);
    },
  });

  rl.registerAction("event.update", {
    description:
      "Patch an event (only supplied fields are changed). Set modifyTarget='series' to edit the entire recurrence instead of a single instance.",
    inputSchema: {
      calendarId: { type: "string", required: true },
      eventId: { type: "string", required: true },
      modifyTarget: {
        type: "string",
        required: false,
        description: "instance (default) | series",
      },
      summary: { type: "string", required: false },
      description: { type: "string", required: false },
      location: { type: "string", required: false },
      start: { type: "string", required: false },
      end: { type: "string", required: false },
      allDay: { type: "boolean", required: false },
      timeZone: { type: "string", required: false },
      attendees: { type: "array", required: false },
      colorId: { type: "string", required: false },
      transparency: { type: "string", required: false },
      visibility: { type: "string", required: false },
      guestsCanInviteOthers: { type: "boolean", required: false },
      guestsCanModify: { type: "boolean", required: false },
      guestsCanSeeOtherGuests: { type: "boolean", required: false },
      reminders: { type: "array", required: false },
      useDefaultReminders: { type: "boolean", required: false },
      rrule: { type: "string", required: false },
      repeatFrequency: { type: "string", required: false },
      repeatHowManyTimes: { type: "number", required: false },
      repeatUntil: { type: "string", required: false },
      sendUpdates: { type: "string", required: false },
      maxAttendees: { type: "number", required: false },
      sendNotifications: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      let eventId = p.eventId as string;
      const calendarId = encodeCalendarId(p.calendarId as string);

      // Series edit: resolve the instance's recurringEventId and patch that instead.
      if (p.modifyTarget === "series") {
        const instance = (await calRequest(
          ctx,
          "GET",
          `/calendars/${calendarId}/events/${eventId}`,
        )) as { recurringEventId?: string };
        if (!instance.recurringEventId) {
          throw new Error(
            `googleCalendar: event ${eventId} is not part of a recurrence series`,
          );
        }
        eventId = instance.recurringEventId;
      }

      const body: EventBody = {};
      if (p.start !== undefined || p.end !== undefined) {
        if (p.start === undefined || p.end === undefined) {
          throw new Error(
            "googleCalendar: start and end must be provided together on update",
          );
        }
        const times = buildEventTimes(
          p.start,
          p.end,
          p.allDay === true,
          p.timeZone as string | undefined,
        );
        body.start = times.start;
        body.end = times.end;
      }
      applyEventFields(body, p);
      const recurrence = buildRecurrence(p);
      if (recurrence) body.recurrence = recurrence;

      const qs: Record<string, unknown> = {};
      if (p.sendUpdates) qs.sendUpdates = p.sendUpdates;
      if (p.sendNotifications !== undefined) qs.sendNotifications = p.sendNotifications;
      if (p.maxAttendees) qs.maxAttendees = p.maxAttendees;

      return calRequest(
        ctx,
        "PATCH",
        `/calendars/${calendarId}/events/${eventId}`,
        body as unknown as Record<string, unknown>,
        qs,
      );
    },
  });

  rl.registerAction("event.delete", {
    description: "Delete an event",
    inputSchema: {
      calendarId: { type: "string", required: true },
      eventId: { type: "string", required: true },
      sendUpdates: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.sendUpdates) qs.sendUpdates = p.sendUpdates;
      return calRequest(
        ctx,
        "DELETE",
        `/calendars/${encodeCalendarId(p.calendarId as string)}/events/${p.eventId}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("event.move", {
    description: "Move an event from one calendar to another",
    inputSchema: {
      calendarId: { type: "string", required: true, description: "Source calendar" },
      eventId: { type: "string", required: true },
      destinationCalendarId: { type: "string", required: true },
      sendUpdates: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        destination: p.destinationCalendarId,
      };
      if (p.sendUpdates) qs.sendUpdates = p.sendUpdates;
      return calRequest(
        ctx,
        "POST",
        `/calendars/${encodeCalendarId(p.calendarId as string)}/events/${p.eventId}/move`,
        undefined,
        qs,
      );
    },
  });
}
