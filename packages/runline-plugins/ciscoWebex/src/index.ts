import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  credentialOk,
  jsonAnswer,
  pathSegment,
  pathWithin,
} from "../../_shared/credentials.js";
import { ciscoWebexCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, ciscoWebexCredential, "ciscoWebex", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  property: string,
  qs?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let next: { path: string; query?: Record<string, unknown> } = {
    path,
    query: { ...qs, max: 100 },
  };

  while (true) {
    const res = await credentialOk(ctx, ciscoWebexCredential, "ciscoWebex", {
      target: "api",
      path: next.path,
      query: next.query,
    });
    const data = (await jsonAnswer(res)) as Record<string, unknown>;
    results.push(...((data[property] as unknown[]) ?? []));

    const link = res.headers.get("link");
    if (link?.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>/);
      if (!match?.[1]) break;
      next = {
        path: pathWithin(ctx, ciscoWebexCredential, "api", match[1]),
      };
    } else {
      break;
    }
  }
  return results;
}

export default function ciscoWebex(rl: RunlinePluginAPI) {
  rl.setName("ciscoWebex");
  rl.setVersion("0.1.0");
  rl.setCredential(ciscoWebexCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Webex access token (OAuth2 or bot token)",
      env: "WEBEX_ACCESS_TOKEN",
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.create", {
    access: "write",
    description: "Send a message to a room or person",
    inputSchema: {
      roomId: {
        type: "string",
        required: false,
        description: "Room ID (use this or toPersonId/toPersonEmail)",
      },
      toPersonId: {
        type: "string",
        required: false,
        description: "Person ID to message",
      },
      toPersonEmail: {
        type: "string",
        required: false,
        description: "Person email to message",
      },
      text: { type: "string", required: true, description: "Message text" },
      markdown: {
        type: "string",
        required: false,
        description: "Markdown-formatted message",
      },
      files: {
        type: "array",
        required: false,
        description: "Array of file URLs to attach",
      },
    },
    async execute(input, ctx) {
      const body = (input ?? {}) as Record<string, unknown>;
      return apiRequest(ctx, "POST", "messages", body);
    },
  });

  rl.registerAction("message.get", {
    access: "read",
    description: "Get message details",
    inputSchema: {
      messageId: { type: "string", required: true, description: "Message ID" },
    },
    async execute(input, ctx) {
      const { messageId } = input as { messageId: string };
      return apiRequest(ctx, "GET", `messages/${pathSegment(messageId)}`);
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description: "List messages in a room",
    inputSchema: {
      roomId: { type: "string", required: true, description: "Room ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (omit for all)",
      },
      mentionedPeople: {
        type: "string",
        required: false,
        description: "Filter: 'me' or person ID",
      },
      before: {
        type: "string",
        required: false,
        description: "List messages before this date (ISO 8601)",
      },
      beforeMessage: {
        type: "string",
        required: false,
        description: "List messages before this message ID",
      },
    },
    async execute(input, ctx) {
      const { roomId, limit, mentionedPeople, before, beforeMessage } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { roomId };
      if (mentionedPeople) qs.mentionedPeople = mentionedPeople;
      if (before) qs.before = before;
      if (beforeMessage) qs.beforeMessage = beforeMessage;

      if (limit) {
        qs.max = limit;
        const data = (await apiRequest(
          ctx,
          "GET",
          "messages",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.items;
      }
      return paginateAll(ctx, "messages", "items", qs);
    },
  });

  rl.registerAction("message.update", {
    access: "write",
    description: "Edit a message",
    inputSchema: {
      messageId: { type: "string", required: true, description: "Message ID" },
      text: { type: "string", required: false, description: "New plain text" },
      markdown: {
        type: "string",
        required: false,
        description: "New markdown text",
      },
    },
    async execute(input, ctx) {
      const { messageId, text, markdown } = input as Record<string, unknown>;
      // Need roomId from original message
      const original = (await apiRequest(
        ctx,
        "GET",
        `messages/${pathSegment(messageId)}`,
      )) as Record<string, unknown>;
      const body: Record<string, unknown> = { roomId: original.roomId };
      if (markdown) body.markdown = markdown;
      else if (text) body.text = text;
      return apiRequest(ctx, "PUT", `messages/${pathSegment(messageId)}`, body);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: {
      messageId: { type: "string", required: true, description: "Message ID" },
    },
    async execute(input, ctx) {
      const { messageId } = input as { messageId: string };
      await apiRequest(ctx, "DELETE", `messages/${pathSegment(messageId)}`);
      return { success: true };
    },
  });

  // ── Meeting ─────────────────────────────────────────

  rl.registerAction("meeting.create", {
    access: "write",
    description: "Create a meeting",
    inputSchema: {
      title: { type: "string", required: true, description: "Meeting title" },
      start: {
        type: "string",
        required: true,
        description: "Start time (ISO 8601)",
      },
      end: {
        type: "string",
        required: true,
        description: "End time (ISO 8601)",
      },
      invitees: {
        type: "array",
        required: false,
        description: "Array of {email} objects",
      },
      agenda: {
        type: "string",
        required: false,
        description: "Meeting agenda",
      },
      password: {
        type: "string",
        required: false,
        description: "Meeting password",
      },
      enabledAutoRecordMeeting: {
        type: "boolean",
        required: false,
        description: "Auto-record",
      },
      allowAnyUserToBeCoHost: {
        type: "boolean",
        required: false,
        description: "Allow any user to be co-host",
      },
    },
    async execute(input, ctx) {
      const body = (input ?? {}) as Record<string, unknown>;
      return apiRequest(ctx, "POST", "meetings", body);
    },
  });

  rl.registerAction("meeting.get", {
    access: "read",
    description: "Get meeting details",
    inputSchema: {
      meetingId: { type: "string", required: true, description: "Meeting ID" },
    },
    async execute(input, ctx) {
      const { meetingId } = input as { meetingId: string };
      return apiRequest(ctx, "GET", `meetings/${pathSegment(meetingId)}`);
    },
  });

  rl.registerAction("meeting.list", {
    access: "read",
    description: "List meetings",
    inputSchema: {
      from: {
        type: "string",
        required: false,
        description: "Start date filter (ISO 8601)",
      },
      to: {
        type: "string",
        required: false,
        description: "End date filter (ISO 8601)",
      },
      meetingType: {
        type: "string",
        required: false,
        description: "Meeting type filter",
      },
      state: { type: "string", required: false, description: "State filter" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (omit for all)",
      },
    },
    async execute(input, ctx) {
      const { from, to, meetingType, state, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (from) qs.from = from;
      if (to) qs.to = to;
      if (meetingType) qs.meetingType = meetingType;
      if (state) qs.state = state;

      if (limit) {
        qs.max = limit;
        const data = (await apiRequest(
          ctx,
          "GET",
          "meetings",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.items;
      }
      return paginateAll(ctx, "meetings", "items", qs);
    },
  });

  rl.registerAction("meeting.update", {
    access: "write",
    description: "Update a meeting",
    inputSchema: {
      meetingId: { type: "string", required: true, description: "Meeting ID" },
      title: { type: "string", required: false, description: "New title" },
      start: {
        type: "string",
        required: false,
        description: "New start time (ISO 8601)",
      },
      end: {
        type: "string",
        required: false,
        description: "New end time (ISO 8601)",
      },
      password: {
        type: "string",
        required: false,
        description: "New password",
      },
      invitees: {
        type: "array",
        required: false,
        description: "Array of {email} objects",
      },
    },
    async execute(input, ctx) {
      const { meetingId, ...fields } = input as Record<string, unknown>;
      // API requires title, password, start, end — fetch current if not provided
      const current = (await apiRequest(
        ctx,
        "GET",
        `meetings/${pathSegment(meetingId)}`,
      )) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        title: fields.title ?? current.title,
        password: fields.password ?? current.password,
        start: fields.start ?? current.start,
        end: fields.end ?? current.end,
        ...fields,
      };
      return apiRequest(ctx, "PUT", `meetings/${pathSegment(meetingId)}`, body);
    },
  });

  rl.registerAction("meeting.delete", {
    access: "write",
    description: "Delete a meeting",
    inputSchema: {
      meetingId: { type: "string", required: true, description: "Meeting ID" },
    },
    async execute(input, ctx) {
      const { meetingId } = input as { meetingId: string };
      await apiRequest(ctx, "DELETE", `meetings/${pathSegment(meetingId)}`);
      return { success: true };
    },
  });
}
