import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  call,
  clientFor,
  filtersSchema,
  idempotentClientFor,
  idSchema,
  objectTypeSchema,
  paginationFields,
  STRICT_OBJECT,
  withConflictRetry,
} from "./shared.js";
import type {
  BwmCreateGroupInput,
  BwmCreateListInput,
  BwmFileUploadInput,
  BwmFilter,
  BwmGroupMembersInput,
  BwmUpdateGroupInput,
  BwmUpdateListInput,
} from "./vendor/models.js";

const idOrIds = t.Union([
  t.String({ minLength: 1 }),
  t.Array(t.String({ minLength: 1 })),
]);

const principalSchema = t.Object(
  {
    type: t.Union([t.Literal("user"), t.Literal("service")], {
      description: "user: a member (see members.list). service: an API key.",
    }),
    id: t.String({ minLength: 1 }),
  },
  STRICT_OBJECT,
);

// ─── saved lists ─────────────────────────────────────────────────

export function registerListActions(rl: RunlinePluginAPI) {
  rl.registerAction("lists.list", {
    access: "read",
    description:
      "Saved lists: curated sets of records of one object type. Each is { id, fields: { $name, $objectType, $description }, relationships: { $records: { values: [ids] } }, createdAt, updatedAt, archivedAt }.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return call(() => clientFor(ctx).listLists());
    },
  });

  rl.registerAction("lists.get", {
    access: "read",
    description: "Read one saved list envelope by id.",
    inputSchema: t.Object({ id: idSchema("List id") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return call(() => clientFor(ctx).getList(id));
    },
  });

  rl.registerAction("lists.create", {
    access: "write",
    description:
      "Create a saved list of one object type, optionally seeded with record ids. Returns the list envelope.",
    inputSchema: t.Object(
      {
        name: t.String({ minLength: 1, maxLength: 200 }),
        objectType: objectTypeSchema(),
        description: t.Optional(t.String({ maxLength: 2_000 })),
        records: t.Optional(idOrIds),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { name, objectType, description, records } = input as {
        name: string;
        objectType: string;
        description?: string;
        records?: string | string[];
      };
      const body: BwmCreateListInput = {
        fields: {
          $name: name,
          $objectType: objectType,
          $description: description,
        },
        relationships: records === undefined ? {} : { $records: records },
      };
      return call(() => idempotentClientFor(ctx).createList(body));
    },
  });

  rl.registerAction("lists.update", {
    access: "write",
    description:
      "Rename a list, change its description, add/remove/replace its records, or archive/restore it. records takes { add, remove, replace } or a bare id / id array as replace. Lost races retry once.",
    inputSchema: t.Object(
      {
        id: idSchema("List id"),
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        description: t.Optional(
          t.Union([t.String({ maxLength: 2_000 }), t.Null()]),
        ),
        records: t.Optional(
          t.Union([
            idOrIds,
            t.Object(
              {
                add: t.Optional(idOrIds),
                remove: t.Optional(idOrIds),
                replace: t.Optional(t.Union([idOrIds, t.Null()])),
              },
              STRICT_OBJECT,
            ),
          ]),
        ),
        archived: t.Optional(t.Boolean()),
      },
      { additionalProperties: false, minProperties: 2 },
    ),
    async execute(input, ctx) {
      const { id, name, description, records, archived } = input as {
        id: string;
        name?: string;
        description?: string | null;
        records?: BwmUpdateListInput["relationships"] extends infer R
          ? R extends { $records?: infer V }
            ? V
            : never
          : never;
        archived?: boolean;
      };
      const body: BwmUpdateListInput = {};
      if (name !== undefined || description !== undefined) {
        body.fields = {};
        if (name !== undefined) body.fields.$name = name;
        if (description !== undefined) body.fields.$description = description;
      }
      if (records !== undefined) body.relationships = { $records: records };
      if (archived !== undefined) body.archived = archived;
      return call(() =>
        withConflictRetry(() => clientFor(ctx).updateList(id, body)),
      );
    },
  });

  rl.registerAction("lists.records", {
    access: "read",
    description:
      "The members of a saved list as record envelopes: { data, object: 'list', totalCount }. Accepts the same filters and pagination as records.list.",
    inputSchema: t.Object(
      {
        id: idSchema("List id"),
        filters: t.Optional(filtersSchema()),
        includeArchived: t.Optional(t.Boolean()),
        ...paginationFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, filters, includeArchived, limit, offset } = input as {
        id: string;
        filters?: BwmFilter[];
        includeArchived?: boolean;
        limit?: number;
        offset?: number;
      };
      return call(() =>
        clientFor(ctx).listListRecords(id, {
          filters,
          includeArchived,
          limit,
          offset,
        }),
      );
    },
  });
}

// ─── groups ──────────────────────────────────────────────────────

export function registerGroupActions(rl: RunlinePluginAPI) {
  rl.registerAction("groups.list", {
    access: "read",
    description:
      "Groups are the subjects of group visibility: { id, slug, name, description, members: [{ type: user | service, id }] }. A record with visibility.mode 'group' is readable by members of its named groups.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return call(() => clientFor(ctx).listGroups());
    },
  });

  rl.registerAction("groups.create", {
    access: "write",
    description:
      "Create a group, optionally with initial members. Requires the configure scope.",
    inputSchema: t.Object(
      {
        slug: t.String({
          pattern: "^[a-z][a-z0-9_]*$",
          maxLength: 100,
          description: "Stable identifier, e.g. sales",
        }),
        name: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String({ minLength: 1, maxLength: 2_000 })),
        members: t.Optional(t.Array(principalSchema)),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = input as BwmCreateGroupInput;
      return call(() => idempotentClientFor(ctx).createGroup(body));
    },
  });

  rl.registerAction("groups.update", {
    access: "write",
    description:
      "Rename a group or change its description. Requires the configure scope. Lost races retry once.",
    inputSchema: t.Object(
      {
        id: idSchema("Group id"),
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        description: t.Optional(
          t.Union([t.String({ maxLength: 2_000 }), t.Null()]),
        ),
      },
      { additionalProperties: false, minProperties: 2 },
    ),
    async execute(input, ctx) {
      const { id, ...body } = input as { id: string } & BwmUpdateGroupInput;
      return call(() =>
        withConflictRetry(() => clientFor(ctx).updateGroup(id, body)),
      );
    },
  });

  rl.registerAction("groups.updateMembers", {
    access: "write",
    description:
      "Add and/or remove principals (members or API keys) from a group. Membership changes take effect on the next read. Requires the configure scope.",
    inputSchema: t.Object(
      {
        id: idSchema("Group id"),
        add: t.Optional(t.Array(principalSchema)),
        remove: t.Optional(t.Array(principalSchema)),
      },
      { additionalProperties: false, minProperties: 2 },
    ),
    async execute(input, ctx) {
      const { id, ...body } = input as { id: string } & BwmGroupMembersInput;
      return call(() => clientFor(ctx).updateGroupMembers(id, body));
    },
  });

  rl.registerAction("groups.delete", {
    access: "write",
    description:
      "Delete a group. Records that named only this group become unreadable to its former members. Requires the configure scope.",
    inputSchema: t.Object({ id: idSchema("Group id") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      await call(() => clientFor(ctx).deleteGroup(id));
      return { id, deleted: true };
    },
  });
}

// ─── members ─────────────────────────────────────────────────────

export function registerMemberActions(rl: RunlinePluginAPI) {
  rl.registerAction("members.list", {
    access: "read",
    description:
      "The organization's members in envelope form: { data: [{ id, fields: { $name, $email, $role } }], object: 'list', totalCount }. Use the id for $owner, $assignedTo, visibility principals ({ type: 'user', id }), and group members.",
    inputSchema: t.Object({ ...paginationFields() }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { limit, offset } = input as { limit?: number; offset?: number };
      return call(() => clientFor(ctx).listMembers({ limit, offset }));
    },
  });
}

// ─── files ───────────────────────────────────────────────────────

export function registerFileActions(rl: RunlinePluginAPI) {
  rl.registerAction("files.createUpload", {
    access: "write",
    description:
      "Start a file upload: returns the file ({ id, status: PENDING, ... }) plus a one-time grant { uploadUrl, uploadMethod, uploadHeaders, expiresAt }. PUT the bytes there yourself, then call files.complete, then attach with records.update({ relationships: { $files: { add: fileId } } }).",
    inputSchema: t.Object(
      {
        filename: t.String({ minLength: 1, maxLength: 500 }),
        mimeType: t.String({ minLength: 1, maxLength: 200 }),
        sizeBytes: t.Integer({ minimum: 1 }),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = input as BwmFileUploadInput;
      return call(() => idempotentClientFor(ctx).createFileUpload(body));
    },
  });

  rl.registerAction("files.complete", {
    access: "write",
    description:
      "Finalize an upload after the bytes were PUT to the grant URL. Returns the file with status COMPLETED.",
    inputSchema: t.Object({ id: idSchema("File id") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return call(() => clientFor(ctx).completeFileUpload(id));
    },
  });

  rl.registerAction("records.fileUrl", {
    access: "read",
    description:
      "Mint a short-lived download URL for a file attached to a record: { url, expiresAt }. Only succeeds when the caller can see the record.",
    inputSchema: t.Object(
      { recordId: idSchema("Record id"), fileId: idSchema("File id") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { recordId, fileId } = input as {
        recordId: string;
        fileId: string;
      };
      return call(() => clientFor(ctx).getRecordFileUrl(recordId, fileId));
    },
  });
}
