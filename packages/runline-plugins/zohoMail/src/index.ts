import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { authedFetch } from "../../_shared/authedFetch.js";
import {
  coordinatedAccessToken,
  requestToken,
} from "../../_shared/tokenRefresh.js";

/**
 * Zoho Mail.
 *
 * The existing `zoho` plugin covers Zoho CRM. This one covers the mailbox, which
 * had no plugin at all.
 *
 * Two Zoho-specific traps, both encoded here so callers do not have to learn them:
 *
 *   1. The auth header is `Authorization: Zoho-oauthtoken <token>`, not `Bearer`.
 *      (The CRM plugin does this too.)
 *   2. Tokens are DATA-CENTRE BOUND. A token minted at accounts.zoho.eu is
 *      rejected by mail.zoho.com, and the failure reads like a permissions
 *      problem rather than a region one. `dc` therefore selects the accounts host
 *      and the API host as a pair, so the two cannot drift apart — rather than
 *      leaving the caller to set a freeform domain.
 *
 * Read-only. Listing, reading and downloading attachments are the operations an
 * agent needs to triage a mailbox; mutations are deliberately left out of this
 * first version.
 */

const DC = {
  com: { accounts: "https://accounts.zoho.com", api: "https://mail.zoho.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://mail.zoho.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://mail.zoho.in" },
  "com.au": {
    accounts: "https://accounts.zoho.com.au",
    api: "https://mail.zoho.com.au",
  },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://mail.zoho.jp" },
  ca: {
    accounts: "https://accounts.zohocloud.ca",
    api: "https://mail.zohocloud.ca",
  },
  "com.cn": {
    accounts: "https://accounts.zoho.com.cn",
    api: "https://mail.zoho.com.cn",
  },
  ae: { accounts: "https://accounts.zoho.ae", api: "https://mail.zoho.ae" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://mail.zoho.sa" },
} as const;

type Dc = keyof typeof DC;

const SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.tags.READ",
];

function hosts(ctx: ActionContext) {
  const dc = (ctx.connection.config.dc as Dc) || "com";
  const h = DC[dc];
  if (!h)
    throw new Error(
      `zohoMail: unknown data centre "${dc}". One of: ${Object.keys(DC).join(", ")}`,
    );
  return h;
}

async function accessToken(ctx: ActionContext): Promise<string> {
  return coordinatedAccessToken(ctx, async (current) => {
    const clientId = current.clientId as string | undefined;
    const clientSecret = current.clientSecret as string | undefined;
    const refreshToken = current.refreshToken as string | undefined;
    if (!clientId || !clientSecret || !refreshToken)
      throw new Error(
        "zohoMail: no stored credentials — run `runline auth zohoMail`, and create the client in the API console for the same data centre as `dc`",
      );
    // Client credentials go in the `application` argument, NOT the parameter map:
    // requestOAuth2Token injects them itself and throws invalid_definition if it
    // finds client_id or client_secret already in the body.
    return requestToken(
      {
        url: `${hosts(ctx).accounts}/oauth/v2/token`,
        // Zoho takes them as form fields rather than a Basic header.
        clientAuthentication: "client_secret_post",
        encoding: "form",
      },
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { clientId, clientSecret },
    );
  });
}

async function api(
  ctx: ActionContext,
  path: string,
  opts: { query?: Record<string, unknown>; binary?: boolean } = {},
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(hosts(ctx).api + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "")
      url.searchParams.set(k, String(v));
  }
  // authedFetch, not bare fetch: this request carries a credential, and a
  // followed redirect would hand the Authorization header to another host.
  const res = await authedFetch(url.toString(), {
    headers: {
      // Zoho's own scheme. A Bearer header fails unhelpfully.
      Authorization: `Zoho-oauthtoken ${token}`,
      // The attachment endpoint returns the file itself and answers
      // `Accept: application/json` with 406 NOT_ACCEPTABLE, so binary reads
      // must not ask for JSON.
      Accept: opts.binary ? "*/*" : "application/json",
    },
  });
  if (!res.ok)
    throw new Error(
      `Zoho Mail error ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  if (opts.binary)
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  const body = (await res.json()) as { data?: unknown };
  return body.data !== undefined ? body.data : body;
}

export default function zohoMail(rl: RunlinePluginAPI) {
  rl.setName("zohoMail");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      dc: t.Optional(
        t.Union(
          (Object.keys(DC) as Dc[]).map((k) => t.Literal(k)),
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
    return id;
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
      return api(ctx, "/api/accounts");
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
        `/api/accounts/${acct(input as Record<string, unknown>, ctx)}/folders`,
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
        `/api/accounts/${acct(input as Record<string, unknown>, ctx)}/labels`,
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
      return api(ctx, `/api/accounts/${acct(i, ctx)}/messages/view`, {
        query: {
          folderId: i.folderId,
          start: i.start,
          limit: i.limit,
          status: i.status,
          includeto: i.includeto,
        },
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
      return api(ctx, `/api/accounts/${acct(i, ctx)}/messages/search`, {
        query: { searchKey: i.searchKey, start: i.start, limit: i.limit },
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
      return api(
        ctx,
        `/api/accounts/${acct(i, ctx)}/folders/${i.folderId}/messages/${i.messageId}/content`,
        { query: { includeBlockContent: i.includeBlockContent } },
      );
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
      return api(
        ctx,
        `/api/accounts/${acct(i, ctx)}/folders/${i.folderId}/messages/${i.messageId}/attachmentinfo`,
      );
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
        base64: await api(
          ctx,
          `/api/accounts/${acct(i, ctx)}/folders/${i.folderId}/messages/${i.messageId}/attachments/${i.attachmentId}`,
          { binary: true },
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
      return api(
        ctx,
        `/api/accounts/${acct(i, ctx)}/folders/${i.folderId}/messages/${i.messageId}/originalmessage`,
      );
    },
  });
}
