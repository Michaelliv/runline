/**
 * Microsoft Outlook mail plugin for runline (Microsoft Graph).
 *
 * Auth: Microsoft identity platform OAuth2 (delegated, acts as the signed-in
 * user → /me) seeded by the OAuth flow; or app-only client credentials
 * (set tenantId/clientId/clientSecret + userUpn) for an unattended service
 * mailbox. Shared "microsoft" OAuth client family (authUrl on
 * login.microsoftonline.com), so one Entra app is reused across the Microsoft
 * plugins. See _shared/microsoftAuth.ts.
 *
 * Graph delegated scopes: Mail.Send, Mail.ReadWrite, Mail.Read.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import { graphRequest, microsoftSetupHelp, userBase } from "../../_shared/microsoftAuth.js";

const NAME = "microsoftMail";
const SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Read",
];

type Ctx = ActionContext;
const recipients = (addrs: string[] | string | undefined) =>
  (Array.isArray(addrs) ? addrs : addrs ? [addrs] : []).map((a) => ({
    emailAddress: { address: a },
  }));

function toMessage(input: any) {
  return {
    subject: input.subject,
    body: { contentType: input.html ? "HTML" : "Text", content: input.body ?? "" },
    toRecipients: recipients(input.to),
    ccRecipients: recipients(input.cc),
  };
}

export default function microsoftMail(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.0.0");

  rl.setConnectionSchema({
    tenantId: { type: "string", required: false, env: "MS_GRAPH_TENANT_ID", description: "Entra tenant id (app-only) or omit for OAuth /common" },
    clientId: { type: "string", required: false, env: "MS_GRAPH_CLIENT_ID", description: "App (client) id" },
    clientSecret: { type: "string", required: false, env: "MS_GRAPH_CLIENT_SECRET", description: "Client secret VALUE" },
    userUpn: { type: "string", required: false, env: "MS_GRAPH_USER_UPN", description: "App-only only: target mailbox UPN (e.g. agent@contoso.com)" },
  });

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    authParams: { prompt: "consent" },
    setupHelp: microsoftSetupHelp("Mail.Send, Mail.ReadWrite, Mail.Read"),
  });

  rl.registerAction("mail.send", {
    description:
      "Send an email as the connected mailbox. Returns {success}. Get user approval before sending external mail.",
    inputSchema: {
      to: { type: "array", required: true, description: "Recipient address(es)" },
      subject: { type: "string", required: true },
      body: { type: "string", required: true },
      cc: { type: "array", required: false },
      html: { type: "boolean", required: false, description: "Body is HTML (default plain text)" },
    },
    async execute(input: any, ctx: Ctx) {
      await graphRequest(ctx, NAME, SCOPES, "POST", `${userBase(ctx)}/sendMail`, {
        message: toMessage(input),
        saveToSentItems: true,
      });
      return { success: true };
    },
  });

  rl.registerAction("mail.draft", {
    description: "Create a draft email (not sent). Returns {id, webLink}.",
    inputSchema: {
      to: { type: "array", required: false },
      subject: { type: "string", required: true },
      body: { type: "string", required: true },
      cc: { type: "array", required: false },
      html: { type: "boolean", required: false },
    },
    async execute(input: any, ctx: Ctx) {
      const r = await graphRequest(ctx, NAME, SCOPES, "POST", `${userBase(ctx)}/messages`, toMessage(input));
      return { id: r.id, webLink: r.webLink };
    },
  });

  rl.registerAction("mail.list", {
    description:
      "List recent messages. Optional KQL search. Returns [{id,subject,from,receivedDateTime,bodyPreview,hasAttachments}].",
    inputSchema: {
      search: { type: "string", required: false, description: "KQL search across the mailbox" },
      top: { type: "number", required: false, default: 20 },
    },
    async execute(input: any, ctx: Ctx) {
      const qs = new URLSearchParams({
        $top: String(input.top ?? 20),
        $select: "id,subject,from,receivedDateTime,bodyPreview,hasAttachments",
        $orderby: "receivedDateTime desc",
      });
      if (input.search) qs.set("$search", `"${input.search}"`);
      const r = await graphRequest(ctx, NAME, SCOPES, "GET", `${userBase(ctx)}/messages?${qs}`);
      return r.value;
    },
  });

  rl.registerAction("mail.get", {
    description: "Get one message with full body by id.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input: any, ctx: Ctx) {
      return graphRequest(ctx, NAME, SCOPES, "GET", `${userBase(ctx)}/messages/${input.id}`);
    },
  });
}
