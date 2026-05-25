/**
 * Microsoft Outlook calendar plugin for runline (Microsoft Graph).
 *
 * Auth: shared "microsoft" OAuth family (delegated → /me) or app-only
 * (tenantId/clientId/clientSecret + userUpn). See _shared/microsoftAuth.ts.
 * Graph delegated scopes: Calendars.Read.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import { graphRequest, microsoftSetupHelp, userBase } from "../../_shared/microsoftAuth.js";

const NAME = "microsoftCalendar";
const SCOPES = ["https://graph.microsoft.com/Calendars.Read"];
type Ctx = ActionContext;

export default function microsoftCalendar(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.0.0");

  rl.setConnectionSchema({
    tenantId: { type: "string", required: false, env: "MS_GRAPH_TENANT_ID", description: "Entra tenant id (app-only) or omit for OAuth /common" },
    clientId: { type: "string", required: false, env: "MS_GRAPH_CLIENT_ID", description: "App (client) id" },
    clientSecret: { type: "string", required: false, env: "MS_GRAPH_CLIENT_SECRET", description: "Client secret VALUE" },
    userUpn: { type: "string", required: false, env: "MS_GRAPH_USER_UPN", description: "App-only only: target user UPN" },
  });

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    authParams: { prompt: "consent" },
    setupHelp: microsoftSetupHelp("Calendars.Read"),
  });

  rl.registerAction("calendar.list", {
    description:
      "List calendar events in a date range. Returns [{id,subject,start,end,location,organizer,attendees}].",
    inputSchema: {
      start: { type: "string", required: true, description: "ISO start datetime, e.g. 2026-05-01T00:00:00Z" },
      end: { type: "string", required: true, description: "ISO end datetime" },
      top: { type: "number", required: false, default: 50 },
    },
    async execute(input: any, ctx: Ctx) {
      const qs = new URLSearchParams({
        startDateTime: input.start,
        endDateTime: input.end,
        $top: String(input.top ?? 50),
        $select: "id,subject,start,end,location,organizer,attendees,isAllDay,webLink",
        $orderby: "start/dateTime",
      });
      const r = await graphRequest(ctx, NAME, SCOPES, "GET", `${userBase(ctx)}/calendarView?${qs}`);
      return r.value;
    },
  });

  rl.registerAction("event.get", {
    description: "Get one calendar event by id (full details incl. body).",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input: any, ctx: Ctx) {
      return graphRequest(ctx, NAME, SCOPES, "GET", `${userBase(ctx)}/events/${input.id}`);
    },
  });
}
