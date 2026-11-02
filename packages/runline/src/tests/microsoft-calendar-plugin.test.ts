import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import microsoftCalendar from "../../../runline-plugins/microsoftCalendar/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("microsoftCalendar");
microsoftCalendar(api);
const plugin = resolve();

/** A connection whose updates commit, as a store's would. */
function context(config: Record<string, unknown> = {}): ActionContext {
  const connection = {
    name: "cal",
    plugin: "microsoftCalendar",
    config: {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "r",
      accessToken: "t",
      ...config,
    },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) connection.config = { ...connection.config, ...patch };
    },
  };
}

async function run(name: string, input: unknown, ctx = context()) {
  return getAction(plugin, name).execute(input, ctx);
}
/** The engine's verdict on an input, normalization included. */
function valid(name: string, input: unknown) {
  return validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;
}

type Seen = { method: string; url: URL; body?: unknown; init: RequestInit };
/** A JSON body parsed; a token request's form body is read by its test. */
const parsed = (body: RequestInit["body"]) => {
  try {
    return body ? JSON.parse(String(body)) : undefined;
  } catch {
    return undefined;
  }
};
function capture(reply: () => Response = () => Response.json({ value: [] })) {
  const seen: Seen[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      method: init?.method ?? "GET",
      url: new URL(String(url)),
      body: parsed(init?.body),
      init: init ?? {},
    });
    return reply();
  });
  return seen;
}
const graphPath = (s: Seen) => s.url.pathname.replace(/^\/v1\.0/, "");

const cal = "AAMk-cal1=";
const shared = `/me/calendars/AAMk-cal1%3D`;
const window = { start: "2026-05-01T00:00:00Z", end: "2026-05-02T00:00:00Z" };
// Each action's input, method and path beneath /v1.0.
const routes: Array<[string, Record<string, unknown>, string, string]> = [
  ["calendar.list", window, "GET", "/me/calendarView"],
  ["calendar.listCalendars", {}, "GET", "/me/calendars"],
  [
    "calendar.getSchedule",
    { schedules: ["a@example.com"], ...window },
    "POST",
    "/me/calendar/getSchedule",
  ],
  [
    "calendar.findMeetingTimes",
    { attendees: ["a@example.com"], ...window },
    "POST",
    "/me/findMeetingTimes",
  ],
  ["event.list", {}, "GET", "/me/events"],
  ["event.get", { id: "e1" }, "GET", "/me/events/e1"],
  [
    "event.listInstances",
    { id: "e1", ...window },
    "GET",
    "/me/events/e1/instances",
  ],
  ["event.create", { subject: "S", ...window }, "POST", "/me/events"],
  ["event.update", { id: "e1", subject: "S" }, "PATCH", "/me/events/e1"],
  ["event.delete", { id: "e1" }, "DELETE", "/me/events/e1"],
  ["event.cancel", { id: "e1" }, "POST", "/me/events/e1/cancel"],
  [
    "event.respond",
    { id: "e1", response: "accept" },
    "POST",
    "/me/events/e1/accept",
  ],
  [
    "event.forward",
    { id: "e1", to: ["c@example.com"] },
    "POST",
    "/me/events/e1/forward",
  ],
];

describe("microsoftCalendar routes", () => {
  it("labels every action's access", () => {
    assert.deepEqual(
      Object.fromEntries(plugin.actions.map((a) => [a.name, a.access])),
      {
        "calendar.list": "read",
        "calendar.listCalendars": "read",
        "calendar.getSchedule": "read",
        "calendar.findMeetingTimes": "read",
        "event.list": "read",
        "event.get": "read",
        "event.listInstances": "read",
        "event.create": "write",
        "event.update": "write",
        "event.delete": "write",
        "event.cancel": "write",
        "event.respond": "write",
        "event.forward": "write",
      },
    );
    assert.deepEqual(
      routes.map(([name]) => name).sort(),
      plugin.actions.map((a) => a.name).sort(),
    );
  });

  for (const [name, input, method, path] of routes)
    it(`${name} → ${method} ${path}`, async () => {
      assert.ok(valid(name, input), "input should validate");
      const seen = capture(() => Response.json({ value: [], id: "e1" }));
      await run(name, input);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, method);
      assert.equal(graphPath(seen[0]), path);
      assert.equal(
        new Headers(seen[0].init.headers).get("authorization"),
        "Bearer t",
      );
    });

  it("works in a calendar shared with or delegated to the user by its calendarId", async () => {
    const seen = capture(() => Response.json({ value: [], id: "e1" }));
    await run("calendar.list", { ...window, calendarId: cal });
    await run("event.list", { calendarId: cal });
    await run("event.create", { subject: "S", ...window, calendarId: cal });
    for (const [name, input] of [
      ["event.get", {}],
      ["event.update", { subject: "S" }],
      ["event.delete", {}],
      ["event.respond", { response: "decline" }],
    ] as const)
      await run(name, { id: "e1", calendarId: cal, ...input });
    assert.deepEqual(
      seen.map((s) => `${s.method} ${graphPath(s)}`),
      [
        `GET ${shared}/calendarView`,
        `GET ${shared}/events`,
        `POST ${shared}/events`,
        `GET ${shared}/events/e1`,
        `PATCH ${shared}/events/e1`,
        `DELETE ${shared}/events/e1`,
        `POST ${shared}/events/e1/decline`,
      ],
    );
  });

  it("acts on the configured mailbox of an app-only connection", async () => {
    const seen = capture(() =>
      String(seen.at(-1)?.url).includes("login.microsoftonline.com")
        ? Response.json({ access_token: "app" })
        : Response.json({ value: [] }),
    );
    await run(
      "calendar.listCalendars",
      {},
      context({
        authMethod: "appOnly",
        tenantId: "tenant",
        userUpn: "dana@example.com",
        accessToken: undefined,
      }),
    );
    assert.equal(graphPath(seen[1]), "/users/dana%40example.com/calendars");
  });

  it("refuses an id that is not one path segment before any request", async () => {
    const seen = capture();
    await assert.rejects(run("event.get", { id: "../e1" }), {
      code: "request_not_allowed",
    });
    assert.equal(seen.length, 0);
  });
});

describe("microsoftCalendar scopes", () => {
  it("renews a delegated token for the calendar scopes, shared calendars included", async () => {
    const seen = capture(() =>
      seen.length === 1
        ? Response.json({ access_token: "fresh", expires_in: 3600 })
        : Response.json({ value: [] }),
    );
    await run(
      "calendar.listCalendars",
      {},
      context({ accessToken: undefined }),
    );
    const form = new URLSearchParams(String(seen[0].init.body));
    assert.deepEqual(form.get("scope")?.split(" ").sort(), [
      "https://graph.microsoft.com/Calendars.ReadWrite",
      "https://graph.microsoft.com/Calendars.ReadWrite.Shared",
      "offline_access",
    ]);
    assert.deepEqual(
      plugin.oauth?.scopes,
      [
        "https://graph.microsoft.com/Calendars.ReadWrite",
        "https://graph.microsoft.com/Calendars.ReadWrite.Shared",
        "offline_access",
      ],
      "login consents to what renewal asks for",
    );
  });
});

describe("microsoftCalendar events", () => {
  it("creates an event: instants in UTC, attendees typed, Teams attached", async () => {
    const seen = capture(() => Response.json({ id: "e1", webLink: "w", x: 1 }));
    const result = await run("event.create", {
      subject: "Sync",
      start: "2026-05-01T10:00:00+03:00",
      end: "2026-05-01T10:30:00+03:00",
      attendees: ["a@example.com"],
      optionalAttendees: ["b@example.com"],
      isOnlineMeeting: true,
      body: "<b>hi</b>",
      html: true,
      showAs: "busy",
      reminderMinutesBeforeStart: 10,
    });
    assert.deepEqual(result, { id: "e1", webLink: "w" });
    assert.deepEqual(seen[0].body, {
      start: { dateTime: "2026-05-01T07:00:00.000", timeZone: "UTC" },
      end: { dateTime: "2026-05-01T07:30:00.000", timeZone: "UTC" },
      isAllDay: false,
      subject: "Sync",
      body: { contentType: "HTML", content: "<b>hi</b>" },
      attendees: [
        { emailAddress: { address: "a@example.com" }, type: "required" },
        { emailAddress: { address: "b@example.com" }, type: "optional" },
      ],
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      showAs: "busy",
      isReminderOn: true,
      reminderMinutesBeforeStart: 10,
    });
  });

  it("reads a time without an offset in timeZone, and all-day dates as midnight", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    await run("event.create", {
      subject: "Local",
      start: "2026-05-01T09:00",
      end: "2026-05-01T09:30",
      timeZone: "Asia/Jerusalem",
    });
    await run("event.create", {
      subject: "Off",
      start: "2026-05-01",
      end: "2026-05-02",
      allDay: true,
      timeZone: "Asia/Jerusalem",
    });
    assert.deepEqual(
      seen.map((s) => (s.body as { start: unknown }).start),
      [
        { dateTime: "2026-05-01T09:00", timeZone: "Asia/Jerusalem" },
        { dateTime: "2026-05-01T00:00:00", timeZone: "Asia/Jerusalem" },
      ],
    );
    assert.equal((seen[1].body as { isAllDay: boolean }).isAllDay, true);
  });

  it("refuses malformed times before any request", async () => {
    const seen = capture();
    for (const [start, end, allDay] of [
      ["2026-05-01", "2026-05-02", false],
      ["2026-05-01T09:00", "2026-05-01T10:00", true],
      ["tomorrow", "2026-05-01T10:00", false],
      ["2026-13-45T99:00Z", "2026-05-01T10:00Z", false],
    ] as const)
      await assert.rejects(
        run("event.create", { subject: "S", start, end, allDay }),
        /start (of an all-day event is YYYY-MM-DD|is not an ISO datetime)/,
      );
    assert.equal(seen.length, 0);
  });

  it("sends a recurrence as given, with the fields Graph requires for its type", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    const recurrence = {
      pattern: {
        type: "weekly",
        interval: 1,
        daysOfWeek: ["monday"],
        firstDayOfWeek: "sunday",
      },
      range: {
        type: "numbered",
        startDate: "2026-05-04",
        numberOfOccurrences: 4,
      },
    };
    await run("event.create", { subject: "Weekly", ...window, recurrence });
    assert.deepEqual(
      (seen[0].body as { recurrence: unknown }).recurrence,
      recurrence,
    );
    const withRecurrence = (
      pattern: object,
      range: object = recurrence.range,
    ) =>
      valid("event.create", {
        subject: "Weekly",
        ...window,
        recurrence: { pattern, range },
      });
    assert.equal(withRecurrence({ type: "hourly", interval: 1 }), false);
    assert.equal(
      withRecurrence({ type: "weekly", interval: 1, daysOfWeek: ["monday"] }),
      false,
    );
    assert.equal(
      withRecurrence({ type: "absoluteMonthly", interval: 1 }),
      false,
    );
    assert.equal(
      withRecurrence(
        { type: "absoluteMonthly", interval: 1, dayOfMonth: 15 },
        { type: "numbered", startDate: "2026-05-15" },
      ),
      false,
    );
    assert.equal(
      withRecurrence(
        { type: "absoluteMonthly", interval: 1, dayOfMonth: 15 },
        { type: "noEnd", startDate: "2026-05-15" },
      ),
      true,
    );
  });

  it("patches only the fields given", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    await run("event.update", { id: "e1", location: "Room 1" });
    assert.deepEqual(seen[0].body, { location: { displayName: "Room 1" } });
  });

  it("asks an update for a change, and for start and end together", async () => {
    const seen = capture();
    assert.equal(valid("event.update", { id: "e1" }), false);
    assert.equal(valid("event.update", { id: "e1", calendarId: cal }), false);
    assert.equal(
      valid("event.update", { id: "e1", timeZone: "UTC", html: true }),
      false,
    );
    await assert.rejects(
      run("event.update", { id: "e1", start: "2026-05-01T10:00:00Z" }),
      /start and end are given together/,
    );
    await assert.rejects(
      run("event.update", { id: "e1", allDay: true }),
      /start and end are given together/,
    );
    assert.equal(seen.length, 0);
  });

  it("replaces the attendee list from both lists", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    await run("event.update", {
      id: "e1",
      optionalAttendees: ["b@example.com"],
    });
    assert.deepEqual(seen[0].body, {
      attendees: [
        { emailAddress: { address: "b@example.com" }, type: "optional" },
      ],
    });
  });

  it("cancels with a comment and forwards to recipients", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    assert.deepEqual(
      await run("event.cancel", { id: "e1", comment: "sorry" }),
      {
        success: true,
      },
    );
    await run("event.forward", {
      id: "e1",
      to: ["c@example.com"],
      comment: "fyi",
    });
    assert.deepEqual(
      seen.map((s) => s.body),
      [
        { comment: "sorry" },
        {
          toRecipients: [{ emailAddress: { address: "c@example.com" } }],
          comment: "fyi",
        },
      ],
    );
    assert.equal(valid("event.forward", { id: "e1", to: [] }), false);
  });

  it("proposes a new time only with decline or tentativelyAccept", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    await run("event.respond", {
      id: "e1",
      response: "tentativelyAccept",
      proposedStart: "2026-05-01T14:00:00",
      proposedEnd: "2026-05-01T14:30:00",
      timeZone: "Asia/Jerusalem",
    });
    assert.deepEqual(seen[0].body, {
      sendResponse: true,
      proposedNewTime: {
        start: { dateTime: "2026-05-01T14:00:00", timeZone: "Asia/Jerusalem" },
        end: { dateTime: "2026-05-01T14:30:00", timeZone: "Asia/Jerusalem" },
      },
    });
    const times = {
      proposedStart: "2026-05-01T14:00:00Z",
      proposedEnd: "2026-05-01T14:30:00Z",
    };
    await assert.rejects(
      run("event.respond", { id: "e1", response: "accept", ...times }),
      /only with decline or tentativelyAccept/,
    );
    await assert.rejects(
      run("event.respond", {
        id: "e1",
        response: "decline",
        sendResponse: false,
        ...times,
      }),
      /sends a response/,
    );
    await assert.rejects(
      run("event.respond", {
        id: "e1",
        response: "decline",
        proposedStart: times.proposedStart,
      }),
      /given together/,
    );
    assert.equal(
      valid("event.respond", { id: "e1", response: "maybe" }),
      false,
    );
    assert.equal(seen.length, 1);
  });
});

describe("microsoftCalendar scheduling and search", () => {
  it("asks for free/busy in the given zone", async () => {
    const seen = capture();
    await run("calendar.getSchedule", {
      schedules: ["a@example.com"],
      start: "2026-05-01T09:00:00",
      end: "2026-05-01T17:00:00",
      timeZone: "Europe/London",
    });
    assert.deepEqual(seen[0].body, {
      schedules: ["a@example.com"],
      startTime: { dateTime: "2026-05-01T09:00:00", timeZone: "Europe/London" },
      endTime: { dateTime: "2026-05-01T17:00:00", timeZone: "Europe/London" },
      availabilityViewInterval: 30,
    });
    assert.equal(
      valid("calendar.getSchedule", { schedules: [], ...window }),
      false,
    );
  });

  it("suggests meeting times", async () => {
    const seen = capture(() =>
      Response.json({
        meetingTimeSuggestions: [{ confidence: 100 }],
        emptySuggestionsReason: "",
      }),
    );
    const result = await run("calendar.findMeetingTimes", {
      attendees: ["a@example.com", "b@example.com"],
      start: "2026-05-04T09:00:00Z",
      end: "2026-05-08T17:00:00Z",
      durationMinutes: 45,
    });
    assert.deepEqual(result, {
      suggestions: [{ confidence: 100 }],
      emptySuggestionsReason: undefined,
    });
    assert.deepEqual(seen[0].body, {
      attendees: [
        { emailAddress: { address: "a@example.com" }, type: "required" },
        { emailAddress: { address: "b@example.com" }, type: "required" },
      ],
      timeConstraint: {
        activityDomain: "work",
        timeSlots: [
          {
            start: { dateTime: "2026-05-04T09:00:00.000", timeZone: "UTC" },
            end: { dateTime: "2026-05-08T17:00:00.000", timeZone: "UTC" },
          },
        ],
      },
      meetingDuration: "PT45M",
      maxCandidates: 5,
      returnSuggestionReasons: true,
    });
  });

  it("finds events by filter, quoting literals", async () => {
    const seen = capture(() => Response.json({ value: [{ id: "e1" }] }));
    assert.deepEqual(
      await run("event.list", {
        subject: "Bob's 1:1",
        organizer: "a@example.com",
        category: "Red",
        modifiedSince: "2026-05-01T00:00:00Z",
        orderBy: "start/dateTime desc",
        top: 10,
      }),
      [{ id: "e1" }],
    );
    const q = seen[0].url.searchParams;
    assert.equal(
      q.get("$filter"),
      "contains(subject,'Bob''s 1:1') and organizer/emailAddress/address eq 'a@example.com' and categories/any(c:c eq 'Red') and lastModifiedDateTime ge 2026-05-01T00:00:00.000Z",
    );
    assert.equal(q.get("$orderby"), "start/dateTime desc");
    assert.equal(q.get("$top"), "10");
  });

  it("takes a positive whole page size and refuses fields an action does not read", () => {
    assert.equal(valid("calendar.list", { ...window, top: 1000 }), true);
    assert.equal(valid("calendar.list", { ...window, top: 0 }), false);
    assert.equal(valid("calendar.list", { ...window, top: 2.5 }), false);
    assert.equal(
      valid("calendar.findMeetingTimes", {
        attendees: ["a@example.com"],
        optionalAttendees: ["b@example.com"],
        ...window,
      }),
      false,
    );
    assert.equal(
      valid("event.get", { id: "e1", user: "x@example.com" }),
      false,
    );
  });
});

describe("microsoftCalendar failures", () => {
  it("reports Graph's error code and never its message", async () => {
    capture(() =>
      Response.json(
        {
          error: {
            code: "ErrorItemNotFound",
            message: "The specified object was not found in the store.",
          },
        },
        { status: 404 },
      ),
    );
    await assert.rejects(run("event.get", { id: "e1" }), {
      message: "microsoftCalendar: request failed (HTTP 404 ErrorItemNotFound)",
    });
  });
});
