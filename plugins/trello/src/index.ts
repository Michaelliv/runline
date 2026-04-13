import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.trello.com/1";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return { apiKey: ctx.connection.config.apiKey as string, token: ctx.connection.config.token as string };
}

async function apiRequest(
  conn: { apiKey: string; token: string }, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("key", conn.apiKey);
  url.searchParams.set("token", conn.token);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0 && method !== "GET") init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Trello error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function trello(rl: RunlinePluginAPI) {
  rl.setName("trello");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Trello API key", env: "TRELLO_API_KEY" },
    token: { type: "string", required: true, description: "Trello API token", env: "TRELLO_TOKEN" },
  });

  // ── Board ───────────────────────────────────────────

  rl.registerAction("board.create", {
    description: "Create a board",
    inputSchema: { name: { type: "string", required: true }, description: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "boards", { name: p.name, desc: p.description });
    },
  });

  rl.registerAction("board.get", {
    description: "Get a board by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `boards/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("board.update", {
    description: "Update a board",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, description: { type: "string", required: false }, closed: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields.name) qs.name = fields.name;
      if (fields.description !== undefined) qs.desc = fields.description;
      if (fields.closed !== undefined) qs.closed = fields.closed;
      return apiRequest(getConn(ctx), "PUT", `boards/${id}`, undefined, qs);
    },
  });

  rl.registerAction("board.delete", {
    description: "Delete a board",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "DELETE", `boards/${(input as Record<string, unknown>).id}`); },
  });

  // ── Board Member ────────────────────────────────────

  rl.registerAction("boardMember.list", {
    description: "List members of a board",
    inputSchema: { boardId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const data = (await apiRequest(getConn(ctx), "GET", `boards/${p.boardId}/members`)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("boardMember.add", {
    description: "Add a member to a board",
    inputSchema: { boardId: { type: "string", required: true }, memberId: { type: "string", required: true }, type: { type: "string", required: true, description: "admin, normal, or observer" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "PUT", `boards/${p.boardId}/members/${p.memberId}`, undefined, { type: p.type });
    },
  });

  rl.registerAction("boardMember.remove", {
    description: "Remove a member from a board",
    inputSchema: { boardId: { type: "string", required: true }, memberId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `boards/${p.boardId}/members/${p.memberId}`);
    },
  });

  // ── Card ────────────────────────────────────────────

  rl.registerAction("card.create", {
    description: "Create a card",
    inputSchema: { listId: { type: "string", required: true }, name: { type: "string", required: true }, description: { type: "string", required: false }, due: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { idList: p.listId, name: p.name };
      if (p.description) body.desc = p.description;
      if (p.due) body.due = p.due;
      return apiRequest(getConn(ctx), "POST", "cards", body);
    },
  });

  rl.registerAction("card.get", {
    description: "Get a card by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `cards/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("card.update", {
    description: "Update a card",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, description: { type: "string", required: false }, closed: { type: "boolean", required: false }, idList: { type: "string", required: false }, due: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields.name) qs.name = fields.name;
      if (fields.description !== undefined) qs.desc = fields.description;
      if (fields.closed !== undefined) qs.closed = fields.closed;
      if (fields.idList) qs.idList = fields.idList;
      if (fields.due) qs.due = fields.due;
      return apiRequest(getConn(ctx), "PUT", `cards/${id}`, undefined, qs);
    },
  });

  rl.registerAction("card.delete", {
    description: "Delete a card",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "DELETE", `cards/${(input as Record<string, unknown>).id}`); },
  });

  // ── Card Comment ────────────────────────────────────

  rl.registerAction("cardComment.create", {
    description: "Add a comment to a card",
    inputSchema: { cardId: { type: "string", required: true }, text: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", `cards/${p.cardId}/actions/comments`, { text: p.text });
    },
  });

  rl.registerAction("cardComment.update", {
    description: "Update a comment on a card",
    inputSchema: { cardId: { type: "string", required: true }, commentId: { type: "string", required: true }, text: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "PUT", `cards/${p.cardId}/actions/${p.commentId}/comments`, undefined, { text: p.text });
    },
  });

  rl.registerAction("cardComment.delete", {
    description: "Delete a comment from a card",
    inputSchema: { cardId: { type: "string", required: true }, commentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `cards/${p.cardId}/actions/${p.commentId}/comments`);
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.create", {
    description: "Create a list on a board",
    inputSchema: { boardId: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "lists", { idBoard: p.boardId, name: p.name });
    },
  });

  rl.registerAction("list.get", {
    description: "Get a list by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `lists/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("list.listAll", {
    description: "List all lists on a board",
    inputSchema: { boardId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const data = (await apiRequest(getConn(ctx), "GET", `boards/${p.boardId}/lists`)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("list.getCards", {
    description: "Get cards in a list",
    inputSchema: { listId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const data = (await apiRequest(getConn(ctx), "GET", `lists/${p.listId}/cards`)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("list.update", {
    description: "Update a list",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, closed: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields.name) qs.name = fields.name;
      if (fields.closed !== undefined) qs.closed = fields.closed;
      return apiRequest(getConn(ctx), "PUT", `lists/${id}`, undefined, qs);
    },
  });

  // ── Attachment ──────────────────────────────────────

  rl.registerAction("attachment.create", {
    description: "Add a URL attachment to a card",
    inputSchema: { cardId: { type: "string", required: true }, url: { type: "string", required: true }, name: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { url: p.url };
      if (p.name) body.name = p.name;
      return apiRequest(getConn(ctx), "POST", `cards/${p.cardId}/attachments`, body);
    },
  });

  rl.registerAction("attachment.get", {
    description: "Get an attachment",
    inputSchema: { cardId: { type: "string", required: true }, id: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "GET", `cards/${p.cardId}/attachments/${p.id}`);
    },
  });

  rl.registerAction("attachment.list", {
    description: "List attachments on a card",
    inputSchema: { cardId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `cards/${(input as Record<string, unknown>).cardId}/attachments`); },
  });

  rl.registerAction("attachment.delete", {
    description: "Delete an attachment from a card",
    inputSchema: { cardId: { type: "string", required: true }, id: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `cards/${p.cardId}/attachments/${p.id}`);
    },
  });

  // ── Checklist ───────────────────────────────────────

  rl.registerAction("checklist.create", {
    description: "Create a checklist on a card",
    inputSchema: { cardId: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", `cards/${p.cardId}/checklists`, { name: p.name });
    },
  });

  rl.registerAction("checklist.get", {
    description: "Get a checklist by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `checklists/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("checklist.list", {
    description: "List checklists on a card",
    inputSchema: { cardId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `cards/${(input as Record<string, unknown>).cardId}/checklists`); },
  });

  rl.registerAction("checklist.delete", {
    description: "Delete a checklist from a card",
    inputSchema: { cardId: { type: "string", required: true }, id: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `cards/${p.cardId}/checklists/${p.id}`);
    },
  });

  rl.registerAction("checklist.createItem", {
    description: "Create a check item in a checklist",
    inputSchema: { checklistId: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", `checklists/${p.checklistId}/checkItems`, { name: p.name });
    },
  });

  rl.registerAction("checklist.updateItem", {
    description: "Update a check item on a card",
    inputSchema: { cardId: { type: "string", required: true }, checkItemId: { type: "string", required: true }, state: { type: "string", required: false, description: "complete or incomplete" }, name: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.state) qs.state = p.state;
      if (p.name) qs.name = p.name;
      return apiRequest(getConn(ctx), "PUT", `cards/${p.cardId}/checkItem/${p.checkItemId}`, undefined, qs);
    },
  });

  rl.registerAction("checklist.deleteItem", {
    description: "Delete a check item from a card",
    inputSchema: { cardId: { type: "string", required: true }, checkItemId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `cards/${p.cardId}/checkItem/${p.checkItemId}`);
    },
  });

  // ── Label ───────────────────────────────────────────

  rl.registerAction("label.create", {
    description: "Create a label on a board",
    inputSchema: { boardId: { type: "string", required: true }, name: { type: "string", required: true }, color: { type: "string", required: true, description: "green, yellow, orange, red, purple, blue, sky, lime, pink, black, null" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "labels", { idBoard: p.boardId, name: p.name, color: p.color });
    },
  });

  rl.registerAction("label.get", {
    description: "Get a label by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `labels/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("label.list", {
    description: "List labels on a board",
    inputSchema: { boardId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `board/${(input as Record<string, unknown>).boardId}/labels`); },
  });

  rl.registerAction("label.update", {
    description: "Update a label",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, color: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "PUT", `labels/${id}`, undefined, fields);
    },
  });

  rl.registerAction("label.delete", {
    description: "Delete a label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "DELETE", `labels/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("label.addToCard", {
    description: "Add a label to a card",
    inputSchema: { cardId: { type: "string", required: true }, labelId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", `cards/${p.cardId}/idLabels`, { value: p.labelId });
    },
  });

  rl.registerAction("label.removeFromCard", {
    description: "Remove a label from a card",
    inputSchema: { cardId: { type: "string", required: true }, labelId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "DELETE", `cards/${p.cardId}/idLabels/${p.labelId}`);
    },
  });
}
