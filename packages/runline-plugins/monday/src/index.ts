import type { RunlinePluginAPI } from "runline";

async function gql(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.monday.com/v2/", {
    method: "POST",
    headers: {
      Authorization: token,
      "API-Version": "2023-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok)
    throw new Error(`Monday.com API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errors)
    throw new Error(
      `Monday.com GraphQL errors: ${JSON.stringify(data.errors)}`,
    );
  return data.data as Record<string, unknown>;
}

export default function monday(rl: RunlinePluginAPI) {
  rl.setName("monday");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Monday.com API token (v2)",
      env: "MONDAY_API_TOKEN",
    },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiToken as string;

  // ── Board ───────────────────────────────────────────

  rl.registerAction("board.create", {
    access: "write",
    description: "Create a board",
    inputSchema: {
      name: { type: "string", required: true },
      kind: {
        type: "string",
        required: true,
        description: "public, private, or share",
      },
      templateId: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { name, kind, templateId } = input as Record<string, unknown>;
      const vars: Record<string, unknown> = { name, kind };
      if (templateId) vars.templateId = templateId;
      const data = await gql(
        tok(ctx),
        `mutation ($name: String!, $kind: BoardKind!, $templateId: ID) { create_board (board_name: $name, board_kind: $kind, template_id: $templateId) { id } }`,
        vars,
      );
      return data.create_board;
    },
  });

  rl.registerAction("board.archive", {
    access: "write",
    description: "Archive a board",
    inputSchema: { boardId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        tok(ctx),
        `mutation ($id: ID!) { archive_board (board_id: $id) { id } }`,
        { id: (input as { boardId: string }).boardId },
      );
      return data.archive_board;
    },
  });

  rl.registerAction("board.get", {
    access: "read",
    description: "Get a board by ID",
    inputSchema: { boardId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        tok(ctx),
        `query ($id: [ID!]) { boards (ids: $id) { id name description state board_folder_id board_kind owners { id } } }`,
        { id: (input as { boardId: string }).boardId },
      );
      return (data.boards as unknown[])?.[0];
    },
  });

  rl.registerAction("board.list", {
    access: "read",
    description: "List boards",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `query ($limit: Int) { boards (limit: $limit) { id name description state board_folder_id board_kind owners { id } } }`,
        limit ? { limit } : {},
      );
      return data.boards;
    },
  });

  // ── Board Column ────────────────────────────────────

  rl.registerAction("boardColumn.create", {
    access: "write",
    description: "Create a column on a board",
    inputSchema: {
      boardId: { type: "string", required: true },
      title: { type: "string", required: true },
      columnType: {
        type: "string",
        required: true,
        description:
          "Column type (status, text, numbers, date, etc.) in snake_case",
      },
      defaults: {
        type: "string",
        required: false,
        description: "Default values as JSON string",
      },
    },
    async execute(input, ctx) {
      const { boardId, title, columnType, defaults } = input as Record<
        string,
        unknown
      >;
      const vars: Record<string, unknown> = { boardId, title, columnType };
      if (defaults)
        vars.defaults = JSON.stringify(JSON.parse(defaults as string));
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) { create_column (board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) { id } }`,
        vars,
      );
      return data.create_column;
    },
  });

  rl.registerAction("boardColumn.list", {
    access: "read",
    description: "List columns on a board",
    inputSchema: { boardId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        tok(ctx),
        `query ($boardId: [ID!]) { boards (ids: $boardId) { columns { id title type settings_str archived } } }`,
        { boardId: (input as { boardId: string }).boardId },
      );
      return (data.boards as Array<Record<string, unknown>>)?.[0]?.columns;
    },
  });

  // ── Board Group ─────────────────────────────────────

  rl.registerAction("boardGroup.create", {
    access: "write",
    description: "Create a group on a board",
    inputSchema: {
      boardId: { type: "string", required: true },
      name: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { boardId, name } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $groupName: String!) { create_group (board_id: $boardId, group_name: $groupName) { id } }`,
        { boardId, groupName: name },
      );
      return data.create_group;
    },
  });

  rl.registerAction("boardGroup.delete", {
    access: "write",
    description: "Delete a group from a board",
    inputSchema: {
      boardId: { type: "string", required: true },
      groupId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { boardId, groupId } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $groupId: String!) { delete_group (board_id: $boardId, group_id: $groupId) { id } }`,
        { boardId, groupId },
      );
      return data.delete_group;
    },
  });

  rl.registerAction("boardGroup.list", {
    access: "read",
    description: "List groups on a board",
    inputSchema: { boardId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        tok(ctx),
        `query ($boardId: [ID!]) { boards (ids: $boardId) { id groups { id title color position archived } } }`,
        { boardId: (input as { boardId: string }).boardId },
      );
      return (data.boards as Array<Record<string, unknown>>)?.[0]?.groups;
    },
  });

  // ── Board Item ──────────────────────────────────────

  rl.registerAction("boardItem.create", {
    access: "write",
    description: "Create an item in a board group",
    inputSchema: {
      boardId: { type: "string", required: true },
      groupId: { type: "string", required: true },
      name: { type: "string", required: true, description: "Item name" },
      columnValues: {
        type: "string",
        required: false,
        description: "Column values as JSON string",
      },
    },
    async execute(input, ctx) {
      const { boardId, groupId, name, columnValues } = input as Record<
        string,
        unknown
      >;
      const vars: Record<string, unknown> = {
        boardId,
        groupId,
        itemName: name,
      };
      if (columnValues)
        vars.columnValues = JSON.stringify(JSON.parse(columnValues as string));
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON) { create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id } }`,
        vars,
      );
      return data.create_item;
    },
  });

  rl.registerAction("boardItem.get", {
    access: "read",
    description: "Get item(s) by ID",
    inputSchema: {
      itemIds: {
        type: "string",
        required: true,
        description: "Comma-separated item IDs",
      },
    },
    async execute(input, ctx) {
      const ids = (input as { itemIds: string }).itemIds
        .split(",")
        .map((s) => s.trim());
      const data = await gql(
        tok(ctx),
        `query ($itemId: [ID!]) { items (ids: $itemId) { id name created_at state column_values { id text type value column { title archived description settings_str } } } }`,
        { itemId: ids },
      );
      return data.items;
    },
  });

  rl.registerAction("boardItem.list", {
    access: "read",
    description: "List items in a board group",
    inputSchema: {
      boardId: { type: "string", required: true },
      groupId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const {
        boardId,
        groupId,
        limit = 100,
      } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `query ($boardId: [ID!], $groupId: [String], $limit: Int) { boards(ids: $boardId) { groups(ids: $groupId) { id items_page(limit: $limit) { cursor items { id name created_at state column_values { id text type value column { title archived description settings_str } } } } } } }`,
        { boardId, groupId, limit },
      );
      return (data.boards as Array<Record<string, unknown>>)?.[0]
        ? (
            (data.boards as Array<Record<string, unknown>>)[0].groups as Array<
              Record<string, unknown>
            >
          )?.[0]
          ? ((
              (data.boards as Array<Record<string, unknown>>)[0]
                .groups as Array<Record<string, unknown>>
            )[0] as Record<string, unknown>)
            ? ((
                (
                  (data.boards as Array<Record<string, unknown>>)[0]
                    .groups as Array<Record<string, unknown>>
                )[0] as Record<string, unknown>
              ).items_page as Record<string, unknown>)
              ? (
                  (
                    (data.boards as Array<Record<string, unknown>>)[0]
                      .groups as Array<Record<string, unknown>>
                  )[0] as Record<string, unknown>
                ).items_page
              : []
            : []
          : []
        : [];
    },
  });

  rl.registerAction("boardItem.delete", {
    access: "write",
    description: "Delete an item",
    inputSchema: { itemId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        tok(ctx),
        `mutation ($itemId: ID!) { delete_item (item_id: $itemId) { id } }`,
        { itemId: (input as { itemId: string }).itemId },
      );
      return data.delete_item;
    },
  });

  rl.registerAction("boardItem.move", {
    access: "write",
    description: "Move an item to a different group",
    inputSchema: {
      itemId: { type: "string", required: true },
      groupId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { itemId, groupId } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `mutation ($groupId: String!, $itemId: ID!) { move_item_to_group (group_id: $groupId, item_id: $itemId) { id } }`,
        { groupId, itemId },
      );
      return data.move_item_to_group;
    },
  });

  rl.registerAction("boardItem.addUpdate", {
    access: "write",
    description: "Add an update (comment) to an item",
    inputSchema: {
      itemId: { type: "string", required: true },
      value: {
        type: "string",
        required: true,
        description: "Update body text",
      },
    },
    async execute(input, ctx) {
      const { itemId, value } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `mutation ($itemId: ID!, $value: String!) { create_update (item_id: $itemId, body: $value) { id } }`,
        { itemId, value },
      );
      return data.create_update;
    },
  });

  rl.registerAction("boardItem.changeColumnValue", {
    access: "write",
    description: "Change a single column value on an item",
    inputSchema: {
      boardId: { type: "string", required: true },
      itemId: { type: "string", required: true },
      columnId: { type: "string", required: true },
      value: {
        type: "string",
        required: true,
        description: "Column value as JSON string",
      },
    },
    async execute(input, ctx) {
      const { boardId, itemId, columnId, value } = input as Record<
        string,
        unknown
      >;
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`,
        {
          boardId,
          itemId,
          columnId,
          value: JSON.stringify(JSON.parse(value as string)),
        },
      );
      return data.change_column_value;
    },
  });

  rl.registerAction("boardItem.changeMultipleColumnValues", {
    access: "write",
    description: "Change multiple column values on an item",
    inputSchema: {
      boardId: { type: "string", required: true },
      itemId: { type: "string", required: true },
      columnValues: {
        type: "string",
        required: true,
        description: "Column values as JSON string",
      },
    },
    async execute(input, ctx) {
      const { boardId, itemId, columnValues } = input as Record<
        string,
        unknown
      >;
      const data = await gql(
        tok(ctx),
        `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { change_multiple_column_values (board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }`,
        {
          boardId,
          itemId,
          columnValues: JSON.stringify(JSON.parse(columnValues as string)),
        },
      );
      return data.change_multiple_column_values;
    },
  });

  rl.registerAction("boardItem.getByColumnValue", {
    access: "read",
    description: "Search items by column value",
    inputSchema: {
      boardId: { type: "string", required: true },
      columnId: { type: "string", required: true },
      columnValue: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const {
        boardId,
        columnId,
        columnValue,
        limit = 100,
      } = input as Record<string, unknown>;
      const data = await gql(
        tok(ctx),
        `query ($boardId: ID!, $columnId: String!, $columnValue: String!, $limit: Int) { items_page_by_column_values (limit: $limit, board_id: $boardId, columns: [{column_id: $columnId, column_values: [$columnValue]}]) { cursor items { id name created_at state board { id } column_values { id text type value column { title archived description settings_str } } } } }`,
        { boardId, columnId, columnValue, limit },
      );
      return (data.items_page_by_column_values as Record<string, unknown>)
        ?.items;
    },
  });
}
