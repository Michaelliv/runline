import {
  type ActionContext,
  credentialRequest,
  jsonAnswer,
  pathSegment,
  type RunlinePluginAPI,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { DCS, SCOPES, zohoMailCredential } from "./credentials.js";

/**
 * Zoho Mail, read-only: accounts, folders, labels, message lists and
 * search, message content, attachments and raw source, which is what
 * triaging a mailbox takes. Zoho CRM is the separate `zoho` plugin.
 *
 * Tokens are bound to a data centre: `credentials.ts` selects the accounts
 * host and the API host as a pair from `dc`.
 */

const STRICT = { additionalProperties: false } as const;
const Id = (description?: string) =>
  t.String({ minLength: 1, ...(description ? { description } : {}) });

/** Zoho's error envelope, `{ status, data: { errorCode, moreInfo? } }`: only the code is kept. */
function zohoError(body: unknown) {
  const data = (body as { data?: { errorCode?: unknown } } | undefined)?.data;
  return { code: data?.errorCode };
}

/** One read of the mail API; a failure reports the status and Zoho's errorCode. */
async function read(
  ctx: ActionContext,
  path: string,
  options: { query?: Record<string, unknown>; accept?: string } = {},
): Promise<Response> {
  const res = await credentialRequest(ctx, zohoMailCredential, {
    target: "api",
    path,
    query: options.query,
    ...(options.accept ? { headers: { Accept: options.accept } } : {}),
  });
  if (!res.ok) throw await responseFailed("zohoMail", res, zohoError);
  return res;
}

/** A JSON read, unwrapped from Zoho's `{ status, data }` envelope. */
async function api(
  ctx: ActionContext,
  path: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const body = await jsonAnswer<{ data?: unknown }>(
    await read(ctx, path, { query }),
  );
  return body.data !== undefined ? body.data : body;
}

/**
 * An attachment's bytes as a googleDrive.file.download result carries
 * them, so the answer passes unedited to a mail plugin's attachment input.
 * The endpoint returns the file itself and answers
 * `Accept: application/json` with 406 NOT_ACCEPTABLE, so it asks for any
 * type.
 */
async function download(
  ctx: ActionContext,
  path: string,
): Promise<{ contentBase64: string; mimeType?: string; size: number }> {
  const res = await read(ctx, path, { accept: "*/*" });
  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type")?.split(";")[0].trim();
  return {
    contentBase64: bytes.toString("base64"),
    ...(mimeType ? { mimeType } : {}),
    size: bytes.byteLength,
  };
}

/** The call's accountId, else the connection's, as one path segment. */
function account(accountId: string | undefined, ctx: ActionContext): string {
  const id = accountId ?? ctx.connection.config.accountId;
  if (typeof id !== "string" || !id)
    throw new Error(
      "zohoMail: accountId required — pass it, set ZOHOMAIL_ACCOUNT_ID, or call account.list first",
    );
  return pathSegment(id);
}

/** `accounts/{accountId}/folders/{folderId}/messages/{messageId}` */
function messagePath(
  input: { accountId?: string; folderId: string; messageId: string },
  ctx: ActionContext,
): string {
  return `accounts/${account(input.accountId, ctx)}/folders/${pathSegment(input.folderId)}/messages/${pathSegment(input.messageId)}`;
}

const AccountId = t.Optional(Id("Defaults to the connection's accountId"));
const Start = t.Optional(
  t.Integer({ minimum: 1, description: "1-based start index (default 1)" }),
);

const accountOnly = t.Object({ accountId: AccountId }, STRICT);
const messageList = t.Object(
  {
    accountId: AccountId,
    folderId: Id("From folder.list. Without it Zoho mixes every folder."),
    start: Start,
    limit: t.Optional(
      t.Integer({ minimum: 1, maximum: 200, description: "Default 25" }),
    ),
    status: t.Optional(
      t.Union([t.Literal("read"), t.Literal("unread"), t.Literal("all")]),
    ),
    includeto: t.Optional(
      t.Boolean({ description: "Include recipient details" }),
    ),
  },
  STRICT,
);
const messageSearch = t.Object(
  {
    accountId: AccountId,
    searchKey: Id(),
    start: Start,
    limit: t.Optional(t.Integer({ minimum: 1 })),
  },
  STRICT,
);
const message = {
  accountId: AccountId,
  folderId: Id("From folder.list or message.list"),
  messageId: Id(),
};
const messageContent = t.Object(
  {
    ...message,
    includeBlockContent: t.Optional(
      t.Boolean({
        description: "Return the reply and the quoted parent separately",
      }),
    ),
  },
  STRICT,
);
const messageOnly = t.Object(message, STRICT);
const attachment = t.Object(
  { ...message, attachmentId: Id("From message.attachmentInfo") },
  STRICT,
);
const original = t.Object({ accountId: AccountId, messageId: Id() }, STRICT);

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

  rl.registerAction("account.list", {
    access: "read",
    description:
      "List the mail accounts this user can access, with accountId and primaryEmailAddress. Call this first — every other action needs an accountId.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return api(ctx, "accounts");
    },
  });

  rl.registerAction("folder.list", {
    access: "read",
    description:
      "List all folders with folderId, folderName and folderType. Match on folderType, not folderName: a mailbox migrated from IMAP can carry a 'Deleted Messages' folder whose folderType is Inbox, distinct from both Trash and Archive.",
    inputSchema: accountOnly,
    async execute(input, ctx) {
      const p = input as t.Static<typeof accountOnly>;
      return api(ctx, `accounts/${account(p.accountId, ctx)}/folders`);
    },
  });

  rl.registerAction("label.list", {
    access: "read",
    description: "List all labels with their ids and display names.",
    inputSchema: accountOnly,
    async execute(input, ctx) {
      const p = input as t.Static<typeof accountOnly>;
      return api(ctx, `accounts/${account(p.accountId, ctx)}/labels`);
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description:
      'List messages in one folder. folderId is required: without it Zoho returns every folder mixed together, so archived and deleted mail is indistinguishable from inbox. Each entry carries a `summary` snippet, usually enough to triage without fetching content. `status` "0" means unread, and receivedTime is epoch milliseconds.',
    inputSchema: messageList,
    async execute(input, ctx) {
      const p = input as t.Static<typeof messageList>;
      return api(ctx, `accounts/${account(p.accountId, ctx)}/messages/view`, {
        folderId: p.folderId,
        start: p.start,
        limit: p.limit,
        status: p.status,
        includeto: p.includeto,
      });
    },
  });

  rl.registerAction("message.search", {
    access: "read",
    description:
      'Search messages. searchKey is {field}:{value}, joined with "::" for AND and ":or:" for OR. Fields include entire, subject, sender, to, cc, content, fileName, fileContent, has:attachment, in:{folderId}, fromDate/toDate as DD-MMM-YYYY. Example: sender:bolt.eu::in:9000000002014',
    inputSchema: messageSearch,
    async execute(input, ctx) {
      const p = input as t.Static<typeof messageSearch>;
      return api(ctx, `accounts/${account(p.accountId, ctx)}/messages/search`, {
        searchKey: p.searchKey,
        start: p.start,
        limit: p.limit,
      });
    },
  });

  rl.registerAction("message.content", {
    access: "read",
    description:
      "Get the full body of one message. Requires folderId as well as messageId.",
    inputSchema: messageContent,
    async execute(input, ctx) {
      const p = input as t.Static<typeof messageContent>;
      return api(ctx, `${messagePath(p, ctx)}/content`, {
        includeBlockContent: p.includeBlockContent,
      });
    },
  });

  rl.registerAction("message.attachmentInfo", {
    access: "read",
    description:
      "List a message's attachments with names, sizes and attachmentIds. Read the filenames before concluding an invoice is attached — senders routinely attach terms and cancellation notices while the figures sit only in the body.",
    inputSchema: messageOnly,
    async execute(input, ctx) {
      const p = input as t.Static<typeof messageOnly>;
      return api(ctx, `${messagePath(p, ctx)}/attachmentinfo`);
    },
  });

  rl.registerAction("message.attachment", {
    access: "read",
    description:
      "Download one attachment. Returns { contentBase64, mimeType, size }, accepted as-is as an attachment by mail plugins; its name is in message.attachmentInfo.",
    inputSchema: attachment,
    async execute(input, ctx) {
      const p = input as t.Static<typeof attachment>;
      return download(
        ctx,
        `${messagePath(p, ctx)}/attachments/${pathSegment(p.attachmentId)}`,
      );
    },
  });

  rl.registerAction("message.original", {
    access: "read",
    description:
      "Get the raw RFC-822 source of a message, attachments inline as base64. Large — prefer message.content plus message.attachment unless the MIME tree itself is needed.",
    inputSchema: original,
    async execute(input, ctx) {
      const p = input as t.Static<typeof original>;
      // Account-wide: with a folder segment in the path Zoho answers
      // 404 URL_RULE_NOT_CONFIGURED.
      return api(
        ctx,
        `accounts/${account(p.accountId, ctx)}/messages/${pathSegment(p.messageId)}/originalmessage`,
      );
    },
  });
}
