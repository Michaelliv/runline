import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverPlugins, Runline } from "runline";
import { promptForCredentials } from "../connection-setup.js";
import { createPluginPickerFactory } from "../plugin-picker.js";
import {
  findRunlineDir,
  loadExtConfig,
  savePiPlugins,
} from "../runline-resolve.js";

function filterByAllowlist<T extends { name?: string; plugin?: string }>(
  items: T[],
  allow: string[] | undefined,
): T[] {
  if (!allow) return [];
  const set = new Set(allow);
  return items.filter((i) => set.has((i.name ?? i.plugin) as string));
}

const runlineCache = new Map<string, Promise<Runline>>();

async function getRunline(cwd: string): Promise<Runline> {
  let pending = runlineCache.get(cwd);
  if (!pending) {
    pending = Runline.fromProject(cwd).then((rl) => {
      if (!rl) throw new Error("No .runline/ found — run `runline init` first");
      return rl;
    });
    // Drop failed loads so the next call retries instead of caching the error.
    pending.catch(() => runlineCache.delete(cwd));
    runlineCache.set(cwd, pending);
  }
  return pending;
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
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter(
                (c): c is { type: "text"; text: string } => c.type === "text",
              )
              .map((c) => c.text)
              .join("\n");
      return new Markdown(
        content,
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
    const runlineDir = findRunlineDir(ctx.cwd);
    if (!runlineDir) return;

    const { showStatus } = loadExtConfig(runlineDir);

    let rl: Runline;
    try {
      rl = await getRunline(ctx.cwd);
    } catch {
      if (ctx.hasUI && showStatus) {
        ctx.ui.setStatus(
          "runline",
          ctx.ui.theme.fg("dim", "runline: load failed"),
        );
      }
      return;
    }

    const { piPlugins } = loadExtConfig(runlineDir);
    const actions = filterByAllowlist(rl.actions(), piPlugins);
    const plugins = filterByAllowlist(rl.plugins(), piPlugins);

    if (plugins.length === 0) {
      if (ctx.hasUI && showStatus) {
        const hint = piPlugins
          ? "runline: no plugins enabled"
          : "runline: /runline-plugins to enable";
        ctx.ui.setStatus("runline", ctx.ui.theme.fg("dim", hint));
      }
      return;
    }

    const alreadyInjected = ctx.sessionManager
      .getEntries()
      .some(
        (e) =>
          e.type === "custom_message" && e.customType === "runline-context",
      );

    if (!alreadyInjected) {
      const pluginList = plugins
        .map((p) => `\`${p.name}\` (${p.actions.length})`)
        .join(", ");

      const content =
        "## Runline\n\n" +
        `This project has runline installed with **${plugins.length} plugins, ${actions.length} actions**. ` +
        "Use the `execute_runline` tool to run JavaScript in a sandbox where each plugin is a top-level global. " +
        "Chain actions, await results, return a value.\n\n" +
        `**Enabled plugins:** ${pluginList}\n\n` +
        "### Discovering actions\n\n" +
        "Inside the sandbox, an `actions` object lets you explore the catalog without leaving `execute_runline`. " +
        "Prefer this over guessing — it's how you find the right action and verify call shapes before invoking.\n\n" +
        "```js\n" +
        'actions.list()                  // every "plugin.action" path\n' +
        'actions.list("github")          // just one plugin\n' +
        'actions.find("create issue")    // ranked fuzzy search — [{path, description, score}]\n' +
        'actions.describe("github.issue.create")\n' +
        "// → { path, plugin, action, description, signature, inputs }\n" +
        'actions.check("github.issue.create", { owner: "a" })\n' +
        "// → { ok, missing, unknown, typeErrors, signature }   (does NOT call the action)\n" +
        "```\n\n" +
        "Unknown paths throw with did-you-mean suggestions, so typos are self-correcting. " +
        "Recommended flow: `find` → `describe` → `check` → call.\n\n" +
        "### Calling actions\n\n" +
        "```js\n" +
        'return await github.issue.create({ owner: "acme", repo: "api", title: "Bug" })\n' +
        "```\n\n" +
        "Plugin globals (`github`, `slack`, ...) and `actions.<plugin>.<action>(...)` both work — same call.\n";

      pi.sendMessage({
        customType: "runline-context",
        content,
        display: true,
      });
    }

    if (ctx.hasUI && showStatus) {
      const theme = ctx.ui.theme;
      ctx.ui.setStatus(
        "runline",
        `⚡${theme.fg("dim", ` runline: ${plugins.length} plugins, ${actions.length} actions`)}`,
      );
    }
  });

  // ── Tools ───────────────────────────────────────────────────────

  pi.registerTool({
    name: "execute_runline",
    label: "Runline Exec",
    description:
      "Execute JavaScript in the runline sandbox. Each installed plugin is a top-level global " +
      "(e.g. `github`, `slack`). Use `return` to surface the result. Async/await supported.",
    promptSnippet:
      "Run JS against runline plugins — chain actions, transform data, return a value",
    parameters: Type.Object({
      code: Type.String({
        description:
          "JavaScript code to execute. Plugins are globals. Use `return` for the final value.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const rl = await getRunline(ctx.cwd);
      // Note: the sandbox currently exposes every registered plugin as a
      // global. The allowlist drives what the agent is told about in its
      // injected context (and what `actions.list()` surfaces in practice,
      // since the agent only knows to look for what was advertised).
      // Plumbing the allowlist through to the sandbox registry is a
      // future improvement.
      const result = await rl.execute(params.code);

      const logs = result.logs?.length
        ? `\n\nLogs:\n${result.logs.join("\n")}`
        : "";

      if (result.error) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}${logs}` }],
          isError: true,
          details: result,
        };
      }

      const value =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result, null, 2);

      return {
        content: [{ type: "text", text: value + logs }],
        details: result,
      };
    },
  });

  // ── Commands ────────────────────────────────────────────────────

  pi.registerCommand("runline-plugins", {
    description: "Pick which runline plugins the agent can use",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const runlineDir = findRunlineDir(ctx.cwd);
      if (!runlineDir) {
        ctx.ui.notify("no .runline/ directory — run `runline init`", "error");
        return;
      }

      // Load the full bundled catalog directly — `Runline.fromProject`
      // gates builtins by `connections[].plugin`, which is the wrong
      // surface for the picker (the picker is HOW you decide which
      // plugins to enable in the first place).
      let allPlugins: Awaited<ReturnType<typeof discoverPlugins>>;
      try {
        allPlugins = await discoverPlugins(runlineDir);
      } catch (err) {
        ctx.ui.notify(
          `runline failed to load plugins: ${(err as Error).message}`,
          "error",
        );
        return;
      }

      const items = allPlugins.map((p) => ({
        name: p.name,
        actionCount: p.actions.length,
      }));
      const { piPlugins } = loadExtConfig(runlineDir);
      const initial = piPlugins ?? [];

      const result = await ctx.ui.custom(
        createPluginPickerFactory(items, initial),
        { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%" } },
      );

      if (!result.selected) {
        ctx.ui.notify("plugin selection cancelled", "info");
        return;
      }

      savePiPlugins(runlineDir, result.selected);

      const previous = new Set(initial);
      const newlyEnabled = result.selected.filter((n) => !previous.has(n));

      ctx.ui.notify(
        `saved — ${result.selected.length} plugin(s) enabled`,
        "info",
      );

      if (newlyEnabled.length > 0) {
        const saved = await promptForCredentials(
          ctx,
          runlineDir,
          allPlugins,
          newlyEnabled,
        );
        if (saved.length > 0) {
          ctx.ui.notify(
            `credentials saved for ${saved.length} plugin(s)`,
            "info",
          );
        }
      }
    },
  });
}
