import {
  type ActionContext,
  credentialOk,
  credentialRequest,
  jsonAnswer,
  pathSegment,
  type RunlinePluginAPI,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { DCS, SCOPES, zohoMailCredential } from "./credentials.js";

/**
 * Zoho Mail.
 *
 * The existing `zoho` plugin covers Zoho CRM. This one covers the mailbox, which
 * had no plugin at all.
 *
 * Tokens are DATA-CENTRE BOUND: see `credentials.ts`, where `dc` selects the
 * accounts host and the API host as a pair.
 *
 * Read-only. Listing, reading and downloading attachments are the operations an
 * agent needs to triage a mailbox; mutations are deliberately left out of this
 * first version.
 */

/** Zoho's error envelope: `{ data: { errorCode, moreInfo? }, status }`. */
function zohoError(body: unknown) {
  const data = (body as { data?: { errorCode?: unknown } } | undefined)?.data;
  return { code: data?.errorCode };
}

/** A JSON read; Zoho wraps every answer in `{ status, data }`. */
async function api(
  ctx: ActionContext,
  path: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialRequest(ctx, zohoMailCredential, {
    target: "api",
    path,
    query: Object.fromEntries(
      Object.entries(query ?? {}).filter(([, v]) => v !== ""),
    ),
  });
  if (!res.ok) throw await responseFailed("zohoMail", res, zohoError);
  const body = await jsonAnswer<{ data?: unknown }>(res);
  return body.data !== undefined ? body.data : body;
}

/**
 * A binary read, as base64. The attachment endpoint returns the file itself
 * and answers `Accept: application/json` with 406 NOT_ACCEPTABLE, so it must
 * not ask for JSON.
 */
async function bytes(ctx: ActionContext, path: string): Promise<string> {
  const res = await credentialOk(ctx, zohoMailCredential, "zohoMail", {
    target: "api",
    path,
    headers: { Accept: "*/*" },
  });
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

/** `accounts/{accountId}/folders/{folderId}/messages/{messageId}` */
function messagePath(i: Record<string, unknown>, acct: string): string {
  return `accounts/${acct}/folders/${pathSegment(i.folderId)}/messages/${pathSegment(i.messageId)}`;
}

export default function zohoMail(rl: RunlinePluginAPI) {
  rl.setName("zohoMail");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      dc: t.Optional(
        t.Union(
          DCS.map((k) => t.Literal(k)),
          {
            env: "ZOHOMAIL_DC",
            description:
              'Data centre the account lives in. Must match the API console the client was created in — a token from one region is rejected by the others. Default "com".',
          },
        ),
      ),
      clientId: t.Optional(
        t.String({
          env: "ZOHOMAIL_CLIENT_ID",
          description:
            "Client ID from the Zoho API console for this data centre",
        }),
      ),
      clientSecret: t.Optional(
        t.String({
          env: "ZOHOMAIL_CLIENT_SECRET",
          description: "Client secret",
        }),
      ),
      refreshToken: t.Optional(
        t.String({
          env: "ZOHOMAIL_REFRESH_TOKEN",
          description: "OAuth2 refresh token (set by the login flow)",
        }),
      ),
      accountId: t.Optional(
        t.String({
          env: "ZOHOMAIL_ACCOUNT_ID",
          description:
            "Default accountId so actions need not repeat it; get it from account.list",
        }),
      ),
    }),
  );

  rl.setCredential(zohoMailCredential);

  rl.setOAuth({
    authUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: SCOPES,
    setupHelp: [
      "You need a Zoho OAuth client. One-time, ~5 minutes.",
      "",
      "FIRST, find your data centre: sign in to Zoho Mail and read the address bar.",
      "  mail.zoho.eu means eu, mail.zoho.com means com, and so on. Set `dc` to it.",
      "  This matters more than it looks: a token issued by one region is rejected",
      "  by every other, and the failure reads like a permissions problem.",
      "",
      "1. Open the API console FOR THAT REGION -- api-console.zoho.eu for eu,",
      "   api-console.zoho.com for com. The console, the accounts host and the API",
      "   host must all match.",
      "2. Add a client of type 'Server-based Application'.",
      "3. Authorized Redirect URI:",
      "     {{redirectUri}}",
      "4. Copy the Client ID and Client Secret.",
      `5. runline auth zohoMail   (scopes: ${SCOPES.join(", ")})`,
      "",
      "A 'Self Client' also works if you would rather not register a redirect URI,",
      "but then you generate a grant token in the console and exchange it yourself;",
      "`runline auth` cannot drive that flow.",
    ],
  });

  const acct = (input: Record<string, unknown>, ctx: ActionContext): string => {
    const id =
      (input.accountId as string) ||
      (ctx.connection.config.accountId as string);
    if (!id)
      throw new Error(
        "zohoMail: accountId required — pass it, set ZOHOMAIL_ACCOUNT_ID, or call account.list first",
      );
    return pathSegment(id);
  };

  const AccountId = t.Optional(
    t.String({ description: "Defaults to the connection's accountId" }),
  );

  rl.registerAction("account.list", {
    access: "read",
    description:
      "List the mail accounts this user can access, with accountId and primaryEmailAddress. Call this first — every other action needs an accountId.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx, "accounts");
    },
  });

  rl.registerAction("folder.list", {
    access: "read",
    description:
      "List all folders with folderId, folderName and folderType. Match on folderType, not folderName: a mailbox migrated from IMAP can carry a 'Deleted Messages' folder whose folderType is Inbox, distinct from both Trash and Archive.",
    inputSchema: t.Object({ accountId: AccountId }),
    async execute(input, ctx) {
      return api(
        ctx,
        `accounts/${acct(input as Record<string, unknown>, ctx)}/folders`,
      );
    },
  });

  rl.registerAction("label.list", {
    access: "read",
    description: "List all labels with their ids and display names.",
    inputSchema: t.Object({ accountId: AccountId }),
    async execute(input, ctx) {
      return api(
        ctx,
        `accounts/${acct(input as Record<string, unknown>, ctx)}/labels`,
      );
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description:
      'List messages in a folder. Always pass folderId: without it Zoho returns every folder mixed together, so archived and deleted mail is indistinguishable from inbox. Each entry carries a `summary` snippet, usually enough to triage without fetching content. Note `status` of "0" means unread, and receivedTime is epoch milliseconds.',
    inputSchema: t.Object({
      accountId: AccountId,
      folderId: t.String({
        description:
          "From folder.list. Omitting it mixes all folders together.",
      }),
      start: t.Optional(
        t.Number({ description: "1-based start index (default 1)" }),
      ),
      limit: t.Optional(t.Number({ description: "Max 200 (default 25)" })),
      status: t.Optional(
        t.Union([t.Literal("read"), t.Literal("unread"), t.Literal("all")]),
      ),
      includeto: t.Optional(
        t.Boolean({ description: "Include recipient details" }),
      ),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return api(ctx, `accounts/${acct(i, ctx)}/messages/view`, {
        folderId: i.folderId,
        start: i.start,
        limit: i.limit,
        status: i.status,
        includeto: i.includeto,
      });
    },
  });

  rl.registerAction("message.search", {
    access: "read",
    description:
      'Search messages. searchKey is {field}:{value}, joined with "::" for AND and ":or:" for OR. Fields include entire, subject, sender, to, cc, content, fileName, fileContent, has:attachment, in:{folderId}, fromDate/toDate as DD-MMM-YYYY. Example: sender:bolt.eu::in:9000000002014',
    inputSchema: t.Object({
      accountId: AccountId,
      searchKey: t.String(),
      start: t.Optional(t.Number()),
      limit: t.Optional(t.Number()),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return api(ctx, `accounts/${acct(i, ctx)}/messages/search`, {
        searchKey: i.searchKey,
        start: i.start,
        limit: i.limit,
      });
    },
  });

  rl.registerAction("message.content", {
    access: "read",
    description:
      "Get the full body of one message. Requires folderId as well as messageId.",
    inputSchema: t.Object({
      accountId: AccountId,
      folderId: t.String(),
      messageId: t.String(),
      includeBlockContent: t.Optional(
        t.Boolean({
          description: "Return the reply and the quoted parent separately",
        }),
      ),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return api(ctx, `${messagePath(i, acct(i, ctx))}/content`, {
        includeBlockContent: i.includeBlockContent,
      });
    },
  });

  rl.registerAction("message.attachmentInfo", {
    access: "read",
    description:
      "List a message's attachments with names, sizes and attachmentIds. Read the filenames before concluding an invoice is attached — senders routinely attach terms and cancellation notices while the figures sit only in the body.",
    inputSchema: t.Object({
      accountId: AccountId,
      folderId: t.String(),
      messageId: t.String(),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return api(ctx, `${messagePath(i, acct(i, ctx))}/attachmentinfo`);
    },
  });

  rl.registerAction("message.attachment", {
    access: "read",
    description: "Download one attachment. Returns { attachmentId, base64 }.",
    inputSchema: t.Object({
      accountId: AccountId,
      folderId: t.String(),
      messageId: t.String(),
      attachmentId: t.String(),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return {
        attachmentId: i.attachmentId,
        base64: await bytes(
          ctx,
          `${messagePath(i, acct(i, ctx))}/attachments/${pathSegment(i.attachmentId)}`,
        ),
      };
    },
  });

  rl.registerAction("message.original", {
    access: "read",
    description:
      "Get the raw RFC-822 source of a message, attachments inline as base64. Large — prefer message.content plus message.attachment unless the MIME tree itself is needed.",
    inputSchema: t.Object({
      accountId: AccountId,
      folderId: t.String(),
      messageId: t.String(),
    }),
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      return api(ctx, `${messagePath(i, acct(i, ctx))}/originalmessage`);
    },
  });
}
