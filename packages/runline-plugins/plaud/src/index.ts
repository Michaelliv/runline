import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  blockContent,
  blocks,
  dateBoundary,
  list,
  PLAUD_OAUTH,
  recording,
  request,
  scan,
} from "./shared.js";

const strict = { additionalProperties: false } as const;
const Id = t.String({ minLength: 1, maxLength: 512 });
const RecordingInput = t.Object({ id: Id }, strict);
const ScanFields = {
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 1000,
      description: "Maximum matching recordings (default 50)",
    }),
  ),
  maxPages: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 10,
      description: "Bounded scan of 100 recordings per page (default 5)",
    }),
  ),
};
const Day = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "UTC date, YYYY-MM-DD",
});

const ListInput = t.Object(
  {
    page: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
    pageSize: t.Optional(t.Integer({ minimum: 10, maximum: 100 })),
  },
  strict,
);
const SearchInput = t.Object(
  {
    query: t.String({ minLength: 1, pattern: "\\S" }),
    from: t.Optional(Day),
    to: t.Optional(Day),
    ...ScanFields,
  },
  strict,
);
const RecentInput = t.Object(
  { days: t.Optional(t.Integer({ minimum: 1, maximum: 365 })), ...ScanFields },
  strict,
);
const TranscriptInput = t.Object(
  {
    id: Id,
    block: t.Optional(
      t.Union([
        t.Literal("transaction"),
        t.Literal("transaction_polish"),
        t.Literal("outline"),
        t.Literal("mark_memo"),
      ]),
    ),
  },
  strict,
);
const SummaryInput = t.Object(
  { id: Id, index: t.Optional(t.Integer({ minimum: 0, maximum: 999 })) },
  strict,
);

export default function plaud(rl: RunlinePluginAPI) {
  rl.setName("plaud");
  rl.setVersion("0.1.0");
  rl.setOAuth({
    protocol: PLAUD_OAUTH,
    scopes: [],
    setupHelp: [
      "Use a Plaud third-party OAuth application approved for access to personal recordings.",
      "Plaud Embedded partner credentials are for a different API and are not interchangeable.",
      "Register this exact Runline callback with Plaud: {{redirectUri}}",
      "Ask Plaud about client registration: https://docs.plaud.ai/plaud-mcp-cli/contact",
      "Supply your own client ID and secret; Runline does not borrow the official CLI's application.",
      "Alternatively seed refreshToken in a host-managed connection. Runline never reads ~/.plaud/tokens.json.",
    ],
  });
  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: false,
      env: "PLAUD_CLIENT_ID",
      description:
        "Your registered third-party OAuth client ID (needed for login)",
    },
    clientSecret: {
      type: "string",
      required: false,
      env: "PLAUD_CLIENT_SECRET",
      description:
        "Your third-party OAuth client secret (needed for login, not refresh)",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "PLAUD_REFRESH_TOKEN",
      description: "Third-party OAuth refresh token",
    },
    accessToken: {
      type: "string",
      required: false,
      env: "PLAUD_ACCESS_TOKEN",
      description: "Cached third-party OAuth access token",
    },
    accessTokenExpiresAt: {
      type: "number",
      required: false,
      description: "Access-token expiry in epoch milliseconds; omit if unknown",
    },
    contentOrigins: {
      type: "array",
      required: false,
      description:
        "Host-approved exact HTTPS origins for signed transcript/summary data_link downloads. Empty by default; never accepts action-supplied origins.",
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get the authenticated Plaud user.",
    inputSchema: t.Object({}, strict),
    execute: (_input, ctx) => request(ctx, "users/current"),
  });
  rl.registerAction("recording.list", {
    access: "read",
    description:
      "List one page of recordings; preserves Plaud's data and pagination fields. Durations are milliseconds.",
    inputSchema: ListInput,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof ListInput>;
      return list(ctx, p.page ?? 1, p.pageSize ?? 20);
    },
  });
  rl.registerAction("recording.get", {
    access: "read",
    description:
      "Get recording metadata, source_list, note_list and any signed audio URL. Returned content is private application data.",
    inputSchema: RecordingInput,
    execute: (input, ctx) =>
      recording(ctx, (input as t.Static<typeof RecordingInput>).id),
  });
  rl.registerAction("recording.search", {
    access: "read",
    description:
      "Case-insensitive name search over a bounded number of pages, not transcript/full-text search. Returns scan counts and truncated; dates are inclusive UTC.",
    inputSchema: SearchInput,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof SearchInput>;
      return scan(ctx, {
        query: p.query,
        from: dateBoundary(p.from, false),
        to: dateBoundary(p.to, true),
        limit: p.limit ?? 50,
        maxPages: p.maxPages ?? 5,
      });
    },
  });
  rl.registerAction("recording.recent", {
    access: "read",
    description:
      "Recordings created within the last N days (default 7). Scans bounded pages; truncated means the result may be incomplete.",
    inputSchema: RecentInput,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof RecentInput>;
      const now = Date.now();
      return scan(ctx, {
        from: now - (p.days ?? 7) * 86_400_000,
        to: now,
        limit: p.limit ?? 50,
        maxPages: p.maxPages ?? 5,
      });
    },
  });
  rl.registerAction("recording.audioUrl", {
    access: "read",
    description:
      "Return Plaud's temporary signed audio URL without downloading audio. Treat the URL as a secret; missing URLs may be transient.",
    inputSchema: RecordingInput,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof RecordingInput>;
      const file = await recording(ctx, id);
      return {
        recordingId: id,
        url:
          typeof file.presigned_url === "string" && file.presigned_url
            ? file.presigned_url
            : null,
      };
    },
  });
  rl.registerAction("transcript.get", {
    access: "read",
    description:
      "Get an original/polished transcript, outline, or highlights. Uses inline content first; signed links require host-approved contentOrigins. JSON content is decoded; segment times remain milliseconds.",
    inputSchema: TranscriptInput,
    async execute(input, ctx) {
      const { id, block = "transaction" } = input as t.Static<
        typeof TranscriptInput
      >;
      const file = await recording(ctx, id);
      const sources = blocks(file, "source_list");
      const content = await blockContent(
        ctx,
        sources.find((source) => source.data_type === block),
      );
      let parsed: unknown = content.content;
      if (content.content) {
        try {
          parsed = JSON.parse(content.content);
        } catch {
          /* Plain-text transcripts are valid. */
        }
      }
      return {
        recordingId: id,
        block,
        ...content,
        content: parsed,
        availableBlocks: sources
          .map((source) => source.data_type)
          .filter((type) => typeof type === "string"),
      };
    },
  });
  rl.registerAction("summary.get", {
    access: "read",
    description:
      "Get an auto_sum_note summary (Markdown). index selects among multiple summaries, starting at 0. Linked content requires host-approved contentOrigins.",
    inputSchema: SummaryInput,
    async execute(input, ctx) {
      const { id, index = 0 } = input as t.Static<typeof SummaryInput>;
      const notes = blocks(await recording(ctx, id), "note_list").filter(
        (note) => note.data_type === "auto_sum_note",
      );
      return {
        recordingId: id,
        index,
        count: notes.length,
        ...(await blockContent(ctx, notes[index])),
      };
    },
  });
  rl.registerAction("note.list", {
    access: "read",
    description:
      "List every note block verbatim, including data_type, titles, inline data_content, and signed data_link. Does not download links.",
    inputSchema: RecordingInput,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof RecordingInput>;
      return {
        recordingId: id,
        notes: blocks(await recording(ctx, id), "note_list"),
      };
    },
  });
}
