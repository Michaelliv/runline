import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api } from "./shared.js";

function fileSchema() {
  return {
    file: t.String({ description: "Global/session file path or absolute URL. Raw local file upload is not supported through Runline JSON actions." }),
    path: t.Optional(t.String({ description: "Destination path" })),
  } as const;
}

function fileForm(input: Record<string, unknown>): FormData {
  const form = new FormData();
  form.set("file", String(input.file));
  if (input.path !== undefined && input.path !== null && input.path !== "") form.set("path", String(input.path));
  return form;
}

function normalizeFilePath(path: unknown): string {
  return String(path).replace(/^\/files\/+/, "").replace(/^\/+/, "");
}

function encodeFilePath(path: unknown): string {
  return normalizeFilePath(path).split("/").map(encodeURIComponent).join("/");
}

export function registerFileActions(rl: RunlinePluginAPI) {
  rl.registerAction("file.list", {
    description: "List global Steel files.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx, "/v1/files");
    },
  });

  rl.registerAction("file.upload", {
    description: "Upload a global file from a URL or existing path reference.",
    inputSchema: t.Object(fileSchema()),
    async execute(input, ctx) {
      return api(ctx, "/v1/files", { method: "POST", body: fileForm(input as Record<string, unknown>) });
    },
  });

  rl.registerAction("file.download", {
    description: "Download/read a global file by path. Binary files are returned as text by fetch when possible; use the URL/API directly for raw bytes.",
    inputSchema: t.Object({ path: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/files/${encodeFilePath((input as { path: string }).path)}`);
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a global Steel file by path.",
    inputSchema: t.Object({ path: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/files/${encodeFilePath((input as { path: string }).path)}`, { method: "DELETE" });
    },
  });

  rl.registerAction("sessionFile.list", {
    description: "List files in a Steel session filesystem.",
    inputSchema: t.Object({ sessionId: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { sessionId: string }).sessionId)}/files`);
    },
  });

  rl.registerAction("sessionFile.upload", {
    description: "Upload/copy a URL or global file into a session filesystem.",
    inputSchema: t.Object({ sessionId: t.String(), ...fileSchema() }),
    async execute(input, ctx) {
      const { sessionId, ...body } = input as Record<string, unknown>;
      return api(ctx, `/v1/sessions/${encodeURIComponent(String(sessionId))}/files`, { method: "POST", body: fileForm(body) });
    },
  });

  rl.registerAction("sessionFile.download", {
    description: "Download/read a session file by path.",
    inputSchema: t.Object({ sessionId: t.String(), path: t.String() }),
    async execute(input, ctx) {
      const { sessionId, path } = input as Record<string, unknown>;
      return api(ctx, `/v1/sessions/${encodeURIComponent(String(sessionId))}/files/${encodeFilePath(path)}`);
    },
  });

  rl.registerAction("sessionFile.downloadArchive", {
    description: "Download/read the zip archive of all files in a session.",
    inputSchema: t.Object({ sessionId: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { sessionId: string }).sessionId)}/files.zip`);
    },
  });

  rl.registerAction("sessionFile.delete", {
    description: "Delete a file from a session filesystem.",
    inputSchema: t.Object({ sessionId: t.String(), path: t.String() }),
    async execute(input, ctx) {
      const { sessionId, path } = input as Record<string, unknown>;
      return api(ctx, `/v1/sessions/${encodeURIComponent(String(sessionId))}/files/${encodeFilePath(path)}`, { method: "DELETE" });
    },
  });

  rl.registerAction("sessionFile.deleteAll", {
    description: "Delete all files in a session filesystem.",
    inputSchema: t.Object({ sessionId: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { sessionId: string }).sessionId)}/files`, { method: "DELETE" });
    },
  });
}
