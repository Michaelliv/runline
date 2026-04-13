import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown, Text } from "@mariozechner/pi-tui";
import { Runline } from "../../../src/sdk.js";

function formatActions(
  actions: Array<{
    plugin: string;
    action: string;
    description?: string;
    inputSchema?: Record<string, { type: string; required?: boolean; description?: string }>;
  }>,
): string {
  const grouped = new Map<string, typeof actions>();
  for (const a of actions) {
    const list = grouped.get(a.plugin) ?? [];
    list.push(a);
    grouped.set(a.plugin, list);
  }

  const lines: string[] = [];
  for (const [plugin, entries] of grouped) {
    lines.push(`### ${plugin}`);
    for (const a of entries) {
      const inputs = a.inputSchema
        ? Object.entries(a.inputSchema)
            .map(
              ([k, v]) =>
                `${k}: ${v.type}${v.required ? "" : "?"}`,
            )
            .join(", ")
        : "";
      const sig = inputs
        ? `\`${plugin}.${a.action}({ ${inputs} })\``
        : `\`${plugin}.${a.action}()\``;
      const desc = a.description ? ` — ${a.description}` : "";
      lines.push(`- ${sig}${desc}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(
    "runline-context",
    (message, { expanded }, theme) => {
      if (!expanded) {
        const label = theme.fg("customMessageLabel", "⚡ runline actions");
        const hint = theme.fg("dim", " — Ctrl+O to expand");
        return new Text(label + hint, 1, 0);
      }
      return new Markdown(
        message.content,
        1,
        0,
        {
          heading: (t) => theme.fg("mdHeading", t),
          link: (t) => theme.fg("mdLink", t),
          linkUrl: (t) => theme.fg("mdLinkUrl", t),
          code: (t) => theme.fg("mdCode", t),
          codeBlock: (t) => theme.fg("mdCodeBlock", t),
          codeBlockBorder: (t) => theme.fg("mdCodeBlockBorder", t),
          quote: (t) => theme.fg("mdQuote", t),
          quoteBorder: (t) => theme.fg("mdQuoteBorder", t),
          hr: (t) => theme.fg("mdHr", t),
          listBullet: (t) => theme.fg("mdListBullet", t),
          bold: (t) => theme.bold(t),
          italic: (t) => theme.italic(t),
          strikethrough: (t) => theme.strikethrough(t),
          underline: (t) => theme.underline(t),
        },
        { color: (t) => theme.fg("customMessageText", t) },
      );
    },
  );

  pi.on("session_start", async (_event, ctx) => {
    const rl = await Runline.fromProject(ctx.cwd);

    if (!rl) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("runline", ctx.ui.theme.fg("dim", "runline: no .runline/"));
      }
      return;
    }

    const actions = rl.actions();
    const plugins = rl.plugins();

    if (actions.length === 0) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("runline", ctx.ui.theme.fg("dim", "runline: no plugins"));
      }
      return;
    }

    // Check if already injected
    const alreadyInjected = ctx.sessionManager
      .getEntries()
      .some(
        (e: any) =>
          e.type === "message" &&
          e.message.role === "custom" &&
          e.message.customType === "runline-context",
      );

    if (!alreadyInjected) {
      const header =
        "## Runline actions\n\n" +
        "This project has runline installed. You can execute JavaScript in a sandbox " +
        "where each installed plugin is a top-level global. Chain actions together, " +
        "call `help()` or `pluginName.help()` inside the sandbox for discovery.\n\n" +
        `**${plugins.length} plugins, ${actions.length} actions available.**\n\n` +
        "Use `runline exec '<code>'` to run code. Examples:\n" +
        "```js\n" +
        "return await github.issue.create({ owner: \"acme\", repo: \"api\", title: \"Bug\" })\n" +
        "```\n\n";

      ctx.sessionManager.appendCustomMessageEntry(
        "runline-context",
        header + formatActions(actions),
        true,
      );
    }

    if (ctx.hasUI) {
      const theme = ctx.ui.theme;
      ctx.ui.setStatus(
        "runline",
        `⚡${theme.fg("dim", ` runline: ${plugins.length} plugins, ${actions.length} actions`)}`,
      );
    }
  });
}
