import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import microsoftCalendar from "../../../runline-plugins/microsoftCalendar/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { method: string; url: string; body?: unknown };

function capture(reply: (url: string) => Response = () => Response.json({})) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("login.microsoftonline.com"))
      return Response.json({ access_token: "t", refresh_token: "r" });
    seen.push({
      method: init?.method ?? "GET",
      url: String(url),
      body: init?.body
        ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
        : undefined,
    });
    return reply(String(url));
  }) as typeof fetch;
  return seen;
}

function run(name: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("microsoftCalendar");
  microsoftCalendar(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, name);
  const ctx: ActionContext = {
    connection: {
      name: "cal",
      plugin: "microsoftCalendar",
      config: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "r",
        accessToken: "t",
        accessTokenExpiresAt: Date.now() + 3_600_000,
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("microsoftCalendar", () => {
  it("annotates every action with its access", () => {
    const { api, resolve } = createPluginAPI("microsoftCalendar");
    microsoftCalendar(api);
    const access = Object.fromEntries(
      resolve().actions.map((a) => [a.name, a.access]),
    );
    assert.deepEqual(access, {
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
    });
  });

  it("lists events of a named calendar", async () => {
    const seen = capture(() => Response.json({ value: [{ id: "e1" }] }));
    const result = await run("calendar.list", {
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-02T00:00:00Z",
      calendarId: "AAMk-cal1=",
    });
    assert.deepEqual(result, [{ id: "e1" }]);
    assert.ok(seen[0].url.includes("/me/calendars/AAMk-cal1%3D/calendarView?"));
  });

  it("creates an event: instants in UTC, attendees typed, Teams attached", async () => {
    const seen = capture(() => Response.json({ id: "e1", webLink: "w", x: 1 }));
    const result = await run("event.create", {
      subject: "Sync",
      start: "2026-05-01T10:00:00+03:00",
      end: "2026-05-01T10:30:00+03:00",
      attendees: "a@example.com",
      optionalAttendees: ["b@example.com"],
      isOnlineMeeting: true,
      body: "<b>hi</b>",
      html: true,
    });
    assert.deepEqual(result, { id: "e1", webLink: "w" });
    assert.equal(seen[0].method, "POST");
    assert.ok(seen[0].url.endsWith("/me/events"));
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
    });
  });

  it("creates an all-day event in a zone", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    await run("event.create", {
      subject: "Off",
      start: "2026-05-01",
      end: "2026-05-02",
      allDay: true,
      timeZone: "Asia/Jerusalem",
    });
    assert.deepEqual(seen[0].body, {
      start: { dateTime: "2026-05-01T00:00:00", timeZone: "Asia/Jerusalem" },
      end: { dateTime: "2026-05-02T00:00:00", timeZone: "Asia/Jerusalem" },
      isAllDay: true,
      subject: "Off",
    });
  });

  it("patches only the fields given and refuses a lone start", async () => {
    const seen = capture(() => Response.json({ id: "e1" }));
    await run("event.update", { id: "e1", location: "Room 1" });
    assert.equal(seen[0].method, "PATCH");
    assert.deepEqual(seen[0].body, { location: { displayName: "Room 1" } });
    await assert.rejects(
      run("event.update", { id: "e1", start: "2026-05-01T10:00:00Z" }),
      /start and end must be given together/,
    );
  });

  it("deletes, cancels and responds", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    assert.deepEqual(await run("event.delete", { id: "e1" }), {
      success: true,
    });
    await run("event.cancel", { id: "e1", comment: "sorry" });
    await run("event.respond", { id: "e1", response: "decline" });
    assert.deepEqual(
      seen.map((s) => [s.method, s.url.split("/v1.0")[1], s.body]),
      [
        ["DELETE", "/me/events/e1", undefined],
        ["POST", "/me/events/e1/cancel", { comment: "sorry" }],
        ["POST", "/me/events/e1/decline", { sendResponse: true }],
      ],
    );
    await assert.rejects(
      run("event.respond", { id: "e1", response: "maybe" }),
      /response must be one of/,
    );
  });

  it("asks for free/busy", async () => {
    const seen = capture(() => Response.json({ value: [] }));
    await run("calendar.getSchedule", {
      schedules: ["a@example.com"],
      start: "2026-05-01T09:00:00",
      end: "2026-05-01T17:00:00",
      timeZone: "Europe/London",
    });
    assert.ok(seen[0].url.endsWith("/me/calendar/getSchedule"));
    assert.deepEqual(seen[0].body, {
      schedules: ["a@example.com"],
      startTime: { dateTime: "2026-05-01T09:00:00", timeZone: "Europe/London" },
      endTime: { dateTime: "2026-05-01T17:00:00", timeZone: "Europe/London" },
      availabilityViewInterval: 30,
    });
  });

  it("suggests meeting times", async () => {
    const seen = capture(() =>
      Response.json({
        meetingTimeSuggestions: [{ confidence: 100 }],
        emptySuggestionsReason: "",
      }),
    );
    const result = await run("calendar.findMeetingTimes", {
      attendees: ["a@example.com"],
      optionalAttendees: "b@example.com",
      start: "2026-05-04T09:00:00Z",
      end: "2026-05-08T17:00:00Z",
      durationMinutes: 45,
    });
    assert.deepEqual(result, {
      suggestions: [{ confidence: 100 }],
      emptySuggestionsReason: undefined,
    });
    assert.ok(seen[0].url.endsWith("/me/findMeetingTimes"));
    assert.deepEqual(seen[0].body, {
      attendees: [
        { emailAddress: { address: "a@example.com" }, type: "required" },
        { emailAddress: { address: "b@example.com" }, type: "optional" },
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
        modifiedSince: "2026-05-01T00:00:00Z",
      }),
      [{ id: "e1" }],
    );
    const url = new URL(seen[0].url);
    assert.ok(url.pathname.endsWith("/me/events"));
    assert.equal(
      url.searchParams.get("$filter"),
      "contains(subject,'Bob''s 1:1') and organizer/emailAddress/address eq 'a@example.com' and lastModifiedDateTime ge 2026-05-01T00:00:00.000Z",
    );
  });

  it("forwards an invitation", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    await run("event.forward", {
      id: "e1",
      to: "c@example.com",
      comment: "fyi",
    });
    assert.ok(seen[0].url.endsWith("/me/events/e1/forward"));
    assert.deepEqual(seen[0].body, {
      toRecipients: [{ emailAddress: { address: "c@example.com" } }],
      comment: "fyi",
    });
    await assert.rejects(
      run("event.forward", { id: "e1", to: [] }),
      /at least one recipient/,
    );
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
    assert.equal(seen.length, 1);
  });
});
