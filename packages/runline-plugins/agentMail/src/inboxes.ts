import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  atLeastOne,
  clientId,
  id,
  inboxFields,
  pageFields,
  STRICT,
} from "./schemas.js";
import { inboxPath, request } from "./shared.js";

const metadataValue = t.Union([
  t.String({ maxLength: 256 }),
  t.Number(),
  t.Boolean(),
]);
const metadataKey = t.String({ maxLength: 256 });
const metadataOptions = { maxProperties: 256, propertyNames: metadataKey };
const status = t.Union([t.Literal("active"), t.Literal("paused")], {
  description:
    "paused stops sending and receiving: sends fail with 403 inbox_paused and incoming mail is neither delivered nor bounced, then or on resume. Stored mail, drafts and API keys are kept; set active to resume.",
});
const list = t.Object(
  { ...pageFields, ascending: t.Optional(t.Boolean()) },
  STRICT,
);
const search = t.Object(
  {
    ...pageFields,
    query: t.String({
      ...id,
      description:
        "Words matching the start of words in the address or display name (sup matches support@…, port does not). An exact address ranks first.",
    }),
  },
  STRICT,
);
const inbox = t.Object(inboxFields, STRICT);
const create = t.Object(
  {
    username: t.Optional(id),
    domain: t.Optional(
      t.String({
        ...id,
        description: "Verified custom domain; defaults to agentmail.to.",
      }),
    ),
    displayName: t.Optional(t.String()),
    status: t.Optional(status),
    clientId: t.Optional(clientId),
    metadata: t.Optional(t.Record(t.String(), metadataValue, metadataOptions)),
  },
  STRICT,
);
const changes = {
  displayName: t.Optional(t.String()),
  status: t.Optional(status),
  metadata: t.Optional(
    t.Union(
      [
        t.Record(t.String(), t.Union([metadataValue, t.Null()]), {
          ...metadataOptions,
          minProperties: 1,
        }),
        t.Null(),
      ],
      {
        description:
          "Merge keys; null values delete keys, metadata: null clears all. Omitted keys stay unchanged.",
      },
    ),
  ),
};
const update = t.Object(
  { ...inboxFields, ...changes },
  { ...STRICT, ...atLeastOne(changes) },
);

export function registerInboxActions(rl: RunlinePluginAPI): void {
  rl.registerAction("inbox.list", {
    access: "read",
    description:
      "List one page of inboxes. Preserves next_page_token; pass it as pageToken for the next page.",
    inputSchema: list,
    execute: (input, ctx) =>
      request(ctx, "inboxes", { query: input as t.Static<typeof list> }),
  });
  rl.registerAction("inbox.search", {
    access: "read",
    description:
      "Search inboxes by address or display name, ranked by relevance. A page can be empty and still carry next_page_token; keep paging until it is absent.",
    inputSchema: search,
    execute: (input, ctx) =>
      request(ctx, "inboxes/search", {
        query: input as t.Static<typeof search>,
      }),
  });
  rl.registerAction("inbox.get", {
    access: "read",
    description: "Get an inbox: its email address, status and metadata.",
    inputSchema: inbox,
    execute: (input, ctx) =>
      request(ctx, inboxPath((input as t.Static<typeof inbox>).inboxId)),
  });
  rl.registerAction("inbox.create", {
    access: "write",
    description:
      "Create an email inbox. Omit username for a random address; use clientId to avoid duplicates when retrying.",
    inputSchema: create,
    execute: (input, ctx) =>
      request(ctx, "inboxes", {
        method: "POST",
        body: input as t.Static<typeof create>,
      }),
  });
  rl.registerAction("inbox.update", {
    access: "write",
    description:
      "Update display name, pause or resume (status), or merge metadata. Requires at least one change; metadata supports explicit null clearing.",
    inputSchema: update,
    execute: (input, ctx) => {
      const { inboxId, ...body } = input as t.Static<typeof update>;
      return request(ctx, inboxPath(inboxId), { method: "PATCH", body });
    },
  });
  rl.registerAction("inbox.delete", {
    access: "write",
    description:
      "Delete an inbox. Destructive; confirm the inbox ID before calling. To stop mail without deleting, set status to paused with inbox.update.",
    inputSchema: inbox,
    execute: (input, ctx) =>
      request(ctx, inboxPath((input as t.Static<typeof inbox>).inboxId), {
        method: "DELETE",
      }),
  });
}
