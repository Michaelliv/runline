/**
 * Todoist plugin for runline, on Todoist's unified API v1.
 *
 * Lists follow API v1's cursors (`next_cursor`, at most 200 a page) and
 * answer one flat array; `limit` stops paging once that many are in.
 * Failures report Todoist's `error_tag` (`UNAUTHORIZED`, `NOT_FOUND`).
 */
import {
  type ActionContext,
  credentialRequest,
  type HttpMethod,
  jsonAnswer,
  pathSegment,
  type RunlinePluginAPI,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { atLeastOne } from "../../_shared/schemas.js";
import { todoistCredential } from "./credentials.js";

/** API v1's largest page. */
const PAGE = 200;

const STRICT = { additionalProperties: false } as const;
const Id = (description?: string) =>
  t.String({ minLength: 1, ...(description ? { description } : {}) });
const Limit = t.Optional(
  t.Integer({ minimum: 1, description: "Stop after this many (default all)" }),
);
const Labels = t.Array(t.String({ minLength: 1 }), {
  description: "Label names",
});
const Priority = t.Integer({
  minimum: 1,
  maximum: 4,
  description: "1 (normal) to 4 (urgent)",
});
const DueDate = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const Filter = (description: string) =>
  t.String({ minLength: 1, maxLength: 1024, description });
const FilterLang = t.Optional(
  Id(
    "IETF language tag the filter query is written in (default English); with filter",
  ),
);
/** A language belongs to a filter query: `lang` only beside `filter`. */
const langWithFilter = {
  anyOf: [{ required: ["filter"] }, { not: { required: ["lang"] } }],
};
const AssigneeId = t.String({
  pattern: "^\\d+$",
  description: "A user id, as project.getCollaborators lists it",
});
/** Todoist's color names, as API v1 lists them. */
const COLORS = [
  "berry_red",
  "red",
  "orange",
  "yellow",
  "olive_green",
  "lime_green",
  "green",
  "mint_green",
  "teal",
  "sky_blue",
  "light_blue",
  "blue",
  "grape",
  "violet",
  "lavender",
  "magenta",
  "salmon",
  "charcoal",
  "grey",
  "taupe",
] as const;
const Color = t.Unsafe<(typeof COLORS)[number]>(
  t.Union(COLORS.map((color) => t.Literal(color))),
);
const ViewStyle = t.Union([
  t.Literal("list"),
  t.Literal("board"),
  t.Literal("calendar"),
]);

/** Todoist's error envelope: only its `error_tag` is read. */
function todoistError(body: unknown) {
  return { code: (body as { error_tag?: unknown } | undefined)?.error_tag };
}

/** One request; a failure reports the status and Todoist's error_tag. */
async function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  options: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
): Promise<unknown> {
  const res = await credentialRequest(ctx, todoistCredential, {
    target: "api",
    path,
    method,
    query: options.query,
    ...(options.body ? { json: options.body } : {}),
  });
  if (!res.ok) throw await responseFailed("todoist", res, todoistError);
  return jsonAnswer(res);
}

/** A request whose answer is an acknowledgement. */
async function act(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
): Promise<{ success: true }> {
  await api(ctx, method, path);
  return { success: true };
}

/** Every item of a cursor-paginated list; `limit` stops paging early. */
async function listAll(
  ctx: ActionContext,
  path: string,
  query: Record<string, unknown> = {},
  limit?: number,
  key: "results" | "items" = "results",
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | null | undefined;
  do {
    const page = (await api(ctx, "GET", path, {
      query: {
        ...query,
        limit: limit ? Math.min(limit - all.length, PAGE) : PAGE,
        cursor,
      },
    })) as Record<string, unknown> & { next_cursor?: string | null };
    all.push(...((page[key] as unknown[] | undefined) ?? []));
    cursor = page.next_cursor;
  } while (cursor && (!limit || all.length < limit));
  return limit ? all.slice(0, limit) : all;
}

/** The defined entries of `fields`, under their API names. */
function wire(
  fields: Record<string, unknown>,
  names: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, name] of Object.entries(names))
    if (fields[key] !== undefined) out[name] = fields[key];
  return out;
}

/** Where a task sits, as API v1 names it. */
const placeNames = {
  projectId: "project_id",
  sectionId: "section_id",
  parentId: "parent_id",
};

/** A task's fields as API v1 names them; assigneeId is sent as a number. */
function taskBody(fields: Record<string, unknown>): Record<string, unknown> {
  const body = wire(fields, {
    content: "content",
    description: "description",
    ...placeNames,
    priority: "priority",
    dueString: "due_string",
    dueDate: "due_date",
    labels: "labels",
  });
  if (typeof fields.assigneeId === "string")
    body.assignee_id = Number(fields.assigneeId);
  return body;
}

const byId = t.Object({ id: Id() }, STRICT);

const taskChanges = {
  content: t.Optional(Id()),
  description: t.Optional(t.String()),
  priority: t.Optional(Priority),
  dueString: t.Optional(Id('Natural language, e.g. "every monday"')),
  dueDate: t.Optional(DueDate),
  labels: t.Optional(Labels),
  assigneeId: t.Optional(AssigneeId),
};
/** Where a task sits; placeNames gives the API's names. */
const taskPlace = {
  projectId: t.Optional(Id()),
  sectionId: t.Optional(Id()),
  parentId: t.Optional(Id()),
};
const taskCreate = t.Object(
  { ...taskChanges, ...taskPlace, content: Id() },
  STRICT,
);
const taskUpdate = t.Object(
  { id: Id(), ...taskChanges },
  { ...STRICT, ...atLeastOne(taskChanges) },
);
const taskSelectors = { ...taskPlace, label: t.Optional(Id()) };
const taskList = t.Object(
  {
    ...taskSelectors,
    filter: t.Optional(
      Filter(
        'Todoist filter query, e.g. "today | overdue"; instead of the fields above',
      ),
    ),
    lang: FilterLang,
    limit: Limit,
  },
  {
    ...STRICT,
    allOf: [
      // A filter query replaces the selectors rather than narrowing them.
      {
        anyOf: [
          { not: { required: ["filter"] } },
          {
            not: {
              anyOf: Object.keys(taskSelectors).map((key) => ({
                required: [key],
              })),
            },
          },
        ],
      },
      langWithFilter,
    ],
  },
);
const taskQuickAdd = t.Object(
  {
    text: Id('e.g. "Buy milk @Grocery #shopping tomorrow"'),
    note: t.Optional(t.String()),
    reminder: t.Optional(Id()),
    autoReminder: t.Optional(
      t.Boolean({
        description:
          "Add the user's default reminder when the task has a due time",
      }),
    ),
  },
  STRICT,
);
const taskMove = t.Object(
  { id: Id(), ...taskPlace },
  {
    ...STRICT,
    oneOf: Object.keys(taskPlace).map((key) => ({ required: [key] })),
  },
);
const taskListCompleted = t.Object(
  {
    since: t.String({
      format: "date-time",
      description: "Start of the window, inclusive, e.g. 2026-05-01T00:00:00Z",
    }),
    until: t.String({
      format: "date-time",
      description: "End of the window, exclusive; at most 3 months after since",
    }),
    ...taskPlace,
    filter: t.Optional(Filter("Todoist filter query the tasks must match")),
    lang: FilterLang,
    limit: Limit,
  },
  { ...STRICT, ...langWithFilter },
);

const projectChanges = {
  name: t.Optional(Id()),
  color: t.Optional(Color),
  isFavorite: t.Optional(t.Boolean()),
  viewStyle: t.Optional(ViewStyle),
};
const projectCreate = t.Object(
  { ...projectChanges, name: Id(), parentId: t.Optional(Id()) },
  STRICT,
);
const projectUpdate = t.Object(
  { id: Id(), ...projectChanges },
  { ...STRICT, ...atLeastOne(projectChanges) },
);

const sectionCreate = t.Object(
  {
    projectId: Id(),
    name: Id(),
    order: t.Optional(
      t.Integer({ description: "Position of the section in the project" }),
    ),
  },
  STRICT,
);
const sectionList = t.Object({ projectId: t.Optional(Id()) }, STRICT);
const sectionUpdate = t.Object({ id: Id(), name: Id() }, STRICT);

/** A comment belongs to a task or to a project, never both. */
const commentOwner = {
  taskId: t.Optional(Id()),
  projectId: t.Optional(Id()),
};
const ownerRule = {
  oneOf: Object.keys(commentOwner).map((key) => ({ required: [key] })),
};
const commentCreate = t.Object(
  { ...commentOwner, content: Id() },
  { ...STRICT, ...ownerRule },
);
const commentList = t.Object(commentOwner, { ...STRICT, ...ownerRule });
const commentUpdate = t.Object({ id: Id(), content: Id() }, STRICT);

const labelChanges = {
  name: t.Optional(Id()),
  color: t.Optional(Color),
  order: t.Optional(t.Integer({ minimum: -32768, maximum: 32767 })),
  isFavorite: t.Optional(t.Boolean()),
};
const labelCreate = t.Object({ ...labelChanges, name: Id() }, STRICT);
const labelUpdate = t.Object(
  { id: Id(), ...labelChanges },
  { ...STRICT, ...atLeastOne(labelChanges) },
);

const projectNames = {
  name: "name",
  color: "color",
  isFavorite: "is_favorite",
  viewStyle: "view_style",
  parentId: "parent_id",
};
const labelNames = {
  name: "name",
  color: "color",
  order: "order",
  isFavorite: "is_favorite",
};

export default function todoist(rl: RunlinePluginAPI) {
  rl.setName("todoist");
  rl.setVersion("1.0.0");
  rl.setCredential(todoistCredential);
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Todoist API token",
      env: "TODOIST_API_TOKEN",
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task",
    inputSchema: taskCreate,
    async execute(input, ctx) {
      return api(ctx, "POST", "tasks", {
        body: taskBody(input as t.Static<typeof taskCreate>),
      });
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return api(ctx, "GET", `tasks/${pathSegment(id)}`);
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description:
      "List active tasks, by project, section, parent or label, or by a Todoist filter query instead",
    inputSchema: taskList,
    async execute(input, ctx) {
      const p = (input ?? {}) as t.Static<typeof taskList>;
      if (p.filter !== undefined)
        return listAll(
          ctx,
          "tasks/filter",
          { query: p.filter, lang: p.lang },
          p.limit,
        );
      return listAll(
        ctx,
        "tasks",
        wire(p, { ...placeNames, label: "label" }),
        p.limit,
      );
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task; only the fields given change",
    inputSchema: taskUpdate,
    async execute(input, ctx) {
      const { id, ...fields } = input as t.Static<typeof taskUpdate>;
      return api(ctx, "POST", `tasks/${pathSegment(id)}`, {
        body: taskBody(fields),
      });
    },
  });

  rl.registerAction("task.close", {
    access: "write",
    description: "Close (complete) a task",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "POST", `tasks/${pathSegment(id)}/close`);
    },
  });

  rl.registerAction("task.reopen", {
    access: "write",
    description: "Reopen a task",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "POST", `tasks/${pathSegment(id)}/reopen`);
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "DELETE", `tasks/${pathSegment(id)}`);
    },
  });

  rl.registerAction("task.quickAdd", {
    access: "write",
    description: "Quick add a task using natural language",
    inputSchema: taskQuickAdd,
    async execute(input, ctx) {
      const p = input as t.Static<typeof taskQuickAdd>;
      return api(ctx, "POST", "tasks/quick", {
        body: wire(p, {
          text: "text",
          note: "note",
          reminder: "reminder",
          autoReminder: "auto_reminder",
        }),
      });
    },
  });

  rl.registerAction("task.move", {
    access: "write",
    description:
      "Move a task to another project, section or parent task (exactly one)",
    inputSchema: taskMove,
    async execute(input, ctx) {
      const { id, ...place } = input as t.Static<typeof taskMove>;
      return api(ctx, "POST", `tasks/${pathSegment(id)}/move`, {
        body: wire(place, placeNames),
      });
    },
  });

  rl.registerAction("task.listCompleted", {
    access: "read",
    description:
      "List tasks completed in a time window of at most 3 months, by completion date",
    inputSchema: taskListCompleted,
    async execute(input, ctx) {
      const p = input as t.Static<typeof taskListCompleted>;
      return listAll(
        ctx,
        "tasks/completed/by_completion_date",
        wire(p, {
          since: "since",
          until: "until",
          ...placeNames,
          filter: "filter_query",
          lang: "filter_lang",
        }),
        p.limit,
        "items",
      );
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a project",
    inputSchema: projectCreate,
    async execute(input, ctx) {
      return api(ctx, "POST", "projects", {
        body: wire(input as t.Static<typeof projectCreate>, projectNames),
      });
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return api(ctx, "GET", `projects/${pathSegment(id)}`);
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List all projects",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return listAll(ctx, "projects");
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update a project; only the fields given change",
    inputSchema: projectUpdate,
    async execute(input, ctx) {
      const { id, ...fields } = input as t.Static<typeof projectUpdate>;
      return api(ctx, "POST", `projects/${pathSegment(id)}`, {
        body: wire(fields, projectNames),
      });
    },
  });

  rl.registerAction("project.delete", {
    access: "write",
    description: "Delete a project",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "DELETE", `projects/${pathSegment(id)}`);
    },
  });

  rl.registerAction("project.archive", {
    access: "write",
    description: "Archive a project",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "POST", `projects/${pathSegment(id)}/archive`);
    },
  });

  rl.registerAction("project.unarchive", {
    access: "write",
    description: "Unarchive a project",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "POST", `projects/${pathSegment(id)}/unarchive`);
    },
  });

  rl.registerAction("project.getCollaborators", {
    access: "read",
    description: "Get project collaborators: [{id,name,email}]",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return listAll(ctx, `projects/${pathSegment(id)}/collaborators`);
    },
  });

  // ── Section ─────────────────────────────────────────

  rl.registerAction("section.create", {
    access: "write",
    description: "Create a section",
    inputSchema: sectionCreate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof sectionCreate>;
      return api(ctx, "POST", "sections", {
        body: wire(p, {
          projectId: "project_id",
          name: "name",
          order: "order",
        }),
      });
    },
  });

  rl.registerAction("section.get", {
    access: "read",
    description: "Get a section",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return api(ctx, "GET", `sections/${pathSegment(id)}`);
    },
  });

  rl.registerAction("section.list", {
    access: "read",
    description: "List sections, of one project or all",
    inputSchema: sectionList,
    async execute(input, ctx) {
      const p = (input ?? {}) as t.Static<typeof sectionList>;
      return listAll(ctx, "sections", wire(p, { projectId: "project_id" }));
    },
  });

  rl.registerAction("section.update", {
    access: "write",
    description: "Rename a section",
    inputSchema: sectionUpdate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof sectionUpdate>;
      return api(ctx, "POST", `sections/${pathSegment(p.id)}`, {
        body: { name: p.name },
      });
    },
  });

  rl.registerAction("section.delete", {
    access: "write",
    description: "Delete a section",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "DELETE", `sections/${pathSegment(id)}`);
    },
  });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", {
    access: "write",
    description: "Comment on a task or on a project (exactly one)",
    inputSchema: commentCreate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof commentCreate>;
      return api(ctx, "POST", "comments", {
        body: wire(p, {
          taskId: "task_id",
          projectId: "project_id",
          content: "content",
        }),
      });
    },
  });

  rl.registerAction("comment.get", {
    access: "read",
    description: "Get a comment",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return api(ctx, "GET", `comments/${pathSegment(id)}`);
    },
  });

  rl.registerAction("comment.list", {
    access: "read",
    description: "List the comments of a task or of a project (exactly one)",
    inputSchema: commentList,
    async execute(input, ctx) {
      const p = input as t.Static<typeof commentList>;
      return listAll(
        ctx,
        "comments",
        wire(p, { taskId: "task_id", projectId: "project_id" }),
      );
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: commentUpdate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof commentUpdate>;
      return api(ctx, "POST", `comments/${pathSegment(p.id)}`, {
        body: { content: p.content },
      });
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "DELETE", `comments/${pathSegment(id)}`);
    },
  });

  // ── Label ───────────────────────────────────────────

  rl.registerAction("label.create", {
    access: "write",
    description: "Create a label",
    inputSchema: labelCreate,
    async execute(input, ctx) {
      return api(ctx, "POST", "labels", {
        body: wire(input as t.Static<typeof labelCreate>, labelNames),
      });
    },
  });

  rl.registerAction("label.get", {
    access: "read",
    description: "Get a label",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return api(ctx, "GET", `labels/${pathSegment(id)}`);
    },
  });

  rl.registerAction("label.list", {
    access: "read",
    description: "List all labels",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return listAll(ctx, "labels");
    },
  });

  rl.registerAction("label.update", {
    access: "write",
    description: "Update a label; only the fields given change",
    inputSchema: labelUpdate,
    async execute(input, ctx) {
      const { id, ...fields } = input as t.Static<typeof labelUpdate>;
      return api(ctx, "POST", `labels/${pathSegment(id)}`, {
        body: wire(fields, labelNames),
      });
    },
  });

  rl.registerAction("label.delete", {
    access: "write",
    description: "Delete a label",
    inputSchema: byId,
    async execute(input, ctx) {
      const { id } = input as t.Static<typeof byId>;
      return act(ctx, "DELETE", `labels/${pathSegment(id)}`);
    },
  });
}
