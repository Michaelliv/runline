import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  const baseUrl = ((c.baseUrl as string) || "https://api.telegram.org").replace(
    /\/$/,
    "",
  );
  return { baseUrl, token: c.accessToken as string };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${conn.baseUrl}/bot${conn.token}/${endpoint}`;
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  if (!res.ok)
    throw new Error(`Telegram error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  return data.result;
}

export default function telegram(rl: RunlinePluginAPI) {
  rl.setName("telegram");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Telegram Bot token",
      env: "TELEGRAM_BOT_TOKEN",
    },
    baseUrl: {
      type: "string",
      required: false,
      description: "API base URL (default: https://api.telegram.org)",
      env: "TELEGRAM_BASE_URL",
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.send", {
    access: "write",
    description: "Send a text message",
    inputSchema: {
      chatId: { type: "string", required: true },
      text: { type: "string", required: true },
      parseMode: {
        type: "string",
        required: false,
        description: "Markdown, MarkdownV2, or HTML",
      },
      disableWebPagePreview: { type: "boolean", required: false },
      disableNotification: { type: "boolean", required: false },
      replyToMessageId: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { chat_id: p.chatId, text: p.text };
      if (p.parseMode) body.parse_mode = p.parseMode;
      if (p.disableWebPagePreview) body.disable_web_page_preview = true;
      if (p.disableNotification) body.disable_notification = true;
      if (p.replyToMessageId) body.reply_to_message_id = p.replyToMessageId;
      return apiRequest(getConn(ctx), "POST", "sendMessage", body);
    },
  });

  rl.registerAction("message.edit", {
    access: "write",
    description: "Edit a text message",
    inputSchema: {
      chatId: { type: "string", required: true },
      messageId: { type: "number", required: true },
      text: { type: "string", required: true },
      parseMode: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: p.text,
      };
      if (p.parseMode) body.parse_mode = p.parseMode;
      return apiRequest(getConn(ctx), "POST", "editMessageText", body);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: {
      chatId: { type: "string", required: true },
      messageId: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "deleteMessage", {
        chat_id: p.chatId,
        message_id: p.messageId,
      });
    },
  });

  rl.registerAction("message.pin", {
    access: "write",
    description: "Pin a message in a chat",
    inputSchema: {
      chatId: { type: "string", required: true },
      messageId: { type: "number", required: true },
      disableNotification: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        message_id: p.messageId,
      };
      if (p.disableNotification) body.disable_notification = true;
      return apiRequest(getConn(ctx), "POST", "pinChatMessage", body);
    },
  });

  rl.registerAction("message.unpin", {
    access: "write",
    description: "Unpin a message in a chat",
    inputSchema: {
      chatId: { type: "string", required: true },
      messageId: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "unpinChatMessage", {
        chat_id: p.chatId,
        message_id: p.messageId,
      });
    },
  });

  rl.registerAction("message.sendLocation", {
    access: "write",
    description: "Send a location",
    inputSchema: {
      chatId: { type: "string", required: true },
      latitude: { type: "number", required: true },
      longitude: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "sendLocation", {
        chat_id: p.chatId,
        latitude: p.latitude,
        longitude: p.longitude,
      });
    },
  });

  rl.registerAction("message.sendChatAction", {
    access: "write",
    description: "Send a chat action (typing, upload_photo, etc.)",
    inputSchema: {
      chatId: { type: "string", required: true },
      action: {
        type: "string",
        required: true,
        description: "typing, upload_photo, record_video, etc.",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "sendChatAction", {
        chat_id: p.chatId,
        action: p.action,
      });
    },
  });

  rl.registerAction("message.sendPhoto", {
    access: "write",
    description: "Send a photo by URL",
    inputSchema: {
      chatId: { type: "string", required: true },
      photo: {
        type: "string",
        required: true,
        description: "Photo URL or file_id",
      },
      caption: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        photo: p.photo,
      };
      if (p.caption) body.caption = p.caption;
      return apiRequest(getConn(ctx), "POST", "sendPhoto", body);
    },
  });

  rl.registerAction("message.sendDocument", {
    access: "write",
    description: "Send a document by URL",
    inputSchema: {
      chatId: { type: "string", required: true },
      document: {
        type: "string",
        required: true,
        description: "Document URL or file_id",
      },
      caption: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        document: p.document,
      };
      if (p.caption) body.caption = p.caption;
      return apiRequest(getConn(ctx), "POST", "sendDocument", body);
    },
  });

  rl.registerAction("message.sendVideo", {
    access: "write",
    description: "Send a video by URL",
    inputSchema: {
      chatId: { type: "string", required: true },
      video: {
        type: "string",
        required: true,
        description: "Video URL or file_id",
      },
      caption: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        video: p.video,
      };
      if (p.caption) body.caption = p.caption;
      return apiRequest(getConn(ctx), "POST", "sendVideo", body);
    },
  });

  rl.registerAction("message.sendSticker", {
    access: "write",
    description: "Send a sticker",
    inputSchema: {
      chatId: { type: "string", required: true },
      sticker: {
        type: "string",
        required: true,
        description: "Sticker URL or file_id",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "sendSticker", {
        chat_id: p.chatId,
        sticker: p.sticker,
      });
    },
  });

  rl.registerAction("message.sendAnimation", {
    access: "write",
    description: "Send a GIF/animation",
    inputSchema: {
      chatId: { type: "string", required: true },
      animation: {
        type: "string",
        required: true,
        description: "Animation URL or file_id",
      },
      caption: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        animation: p.animation,
      };
      if (p.caption) body.caption = p.caption;
      return apiRequest(getConn(ctx), "POST", "sendAnimation", body);
    },
  });

  rl.registerAction("message.sendAudio", {
    access: "write",
    description: "Send audio by URL",
    inputSchema: {
      chatId: { type: "string", required: true },
      audio: {
        type: "string",
        required: true,
        description: "Audio URL or file_id",
      },
      caption: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        chat_id: p.chatId,
        audio: p.audio,
      };
      if (p.caption) body.caption = p.caption;
      return apiRequest(getConn(ctx), "POST", "sendAudio", body);
    },
  });

  // ── Chat ────────────────────────────────────────────

  rl.registerAction("chat.get", {
    access: "read",
    description: "Get chat info",
    inputSchema: { chatId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "POST", "getChat", {
        chat_id: (input as Record<string, unknown>).chatId,
      });
    },
  });

  rl.registerAction("chat.getAdministrators", {
    access: "read",
    description: "Get chat administrators",
    inputSchema: { chatId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "POST", "getChatAdministrators", {
        chat_id: (input as Record<string, unknown>).chatId,
      });
    },
  });

  rl.registerAction("chat.getMember", {
    access: "read",
    description: "Get a chat member",
    inputSchema: {
      chatId: { type: "string", required: true },
      userId: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "getChatMember", {
        chat_id: p.chatId,
        user_id: p.userId,
      });
    },
  });

  rl.registerAction("chat.leave", {
    access: "write",
    description: "Leave a chat",
    inputSchema: { chatId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "POST", "leaveChat", {
        chat_id: (input as Record<string, unknown>).chatId,
      });
    },
  });

  rl.registerAction("chat.setDescription", {
    access: "write",
    description: "Set chat description",
    inputSchema: {
      chatId: { type: "string", required: true },
      description: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "setChatDescription", {
        chat_id: p.chatId,
        description: p.description,
      });
    },
  });

  rl.registerAction("chat.setTitle", {
    access: "write",
    description: "Set chat title",
    inputSchema: {
      chatId: { type: "string", required: true },
      title: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "setChatTitle", {
        chat_id: p.chatId,
        title: p.title,
      });
    },
  });

  // ── Callback ────────────────────────────────────────

  rl.registerAction("callback.answer", {
    access: "write",
    description: "Answer a callback query",
    inputSchema: {
      callbackQueryId: { type: "string", required: true },
      text: { type: "string", required: false },
      showAlert: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        callback_query_id: p.callbackQueryId,
      };
      if (p.text) body.text = p.text;
      if (p.showAlert) body.show_alert = true;
      return apiRequest(getConn(ctx), "POST", "answerCallbackQuery", body);
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description: "Get file metadata (use result.file_path to download)",
    inputSchema: { fileId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "POST", "getFile", {
        file_id: (input as Record<string, unknown>).fileId,
      });
    },
  });
}
