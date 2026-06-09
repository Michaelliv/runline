import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api, compactRecord } from "./shared.js";

export function registerCaptchaActions(rl: RunlinePluginAPI) {
  rl.registerAction("captcha.status", {
    description: "Get CAPTCHA detection/solving status for a Steel session.",
    inputSchema: t.Object({ sessionId: t.String() }),
    async execute(input, ctx) { return api(ctx, `/v1/sessions/${encodeURIComponent((input as { sessionId: string }).sessionId)}/captchas/status`); },
  });
  rl.registerAction("captcha.solve", {
    description: "Trigger CAPTCHA solving for all detected CAPTCHAs or a specific task/url/page.",
    inputSchema: t.Object({ sessionId: t.String(), taskId: t.Optional(t.String()), url: t.Optional(t.String()), pageId: t.Optional(t.String()) }),
    async execute(input, ctx) { const { sessionId, ...body } = input as Record<string, unknown>; return api(ctx, `/v1/sessions/${encodeURIComponent(String(sessionId))}/captchas/solve`, { method: "POST", body: compactRecord(body) }); },
  });
  rl.registerAction("captcha.solveImage", {
    description: "Solve an image CAPTCHA by XPath selectors.",
    inputSchema: t.Object({ sessionId: t.String(), imageXPath: t.String(), inputXPath: t.String(), url: t.Optional(t.String()) }),
    async execute(input, ctx) { const { sessionId, ...body } = input as Record<string, unknown>; return api(ctx, `/v1/sessions/${encodeURIComponent(String(sessionId))}/captchas/solve-image`, { method: "POST", body: compactRecord(body) }); },
  });
}
