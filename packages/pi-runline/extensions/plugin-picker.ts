import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import {
  fuzzyFilter,
  Input,
  Key,
  matchesKey,
  visibleWidth,
} from "@mariozechner/pi-tui";

export interface PluginPickerItem {
  name: string;
  actionCount: number;
  /** Plugin already has a stored connection — eligible for Ctrl-R reconfigure. */
  connected?: boolean;
}

export interface PluginPickerResult {
  /** undefined = cancelled */
  selected?: string[];
  /** Set when the user pressed Ctrl-R on a connected plugin. */
  reconfigure?: string;
}

/**
 * Multi-select fuzzy picker for runline plugin names.
 *
 * Keys:
 *   ↑ / ↓       — move highlight
 *   space       — toggle current item
 *   Ctrl-A      — toggle all (filtered view)
 *   enter       — save and close
 *   esc / C-c   — cancel
 *   type        — fuzzy filter
 */
export class PluginPicker implements Component {
  private readonly items: PluginPickerItem[];
  private readonly selected: Set<string>;
  private readonly input: Input;
  private readonly theme: Theme;
  private readonly onDone: (result: PluginPickerResult) => void;
  private filtered: PluginPickerItem[];
  private cursor = 0;
  private readonly maxRows = 18;

  constructor(
    items: PluginPickerItem[],
    initiallySelected: Iterable<string>,
    theme: Theme,
    onDone: (result: PluginPickerResult) => void,
  ) {
    this.items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    this.selected = new Set(initiallySelected);
    this.filtered = this.items;
    this.theme = theme;
    this.onDone = onDone;

    this.input = new Input();
    this.input.focused = true;
    this.input.onSubmit = () => this.confirm();
    this.input.onEscape = () => this.cancel();
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const theme = this.theme;
    // Reserve two columns for the border and one space of padding on each side.
    const inner = Math.max(10, width - 4);
    const body: string[] = [];

    body.push(
      theme.fg(
        "mdHeading",
        `runline plugins · ${this.selected.size}/${this.items.length} enabled`,
      ),
    );
    body.push(
      theme.fg(
        "dim",
        "type to filter · space toggle · ^A toggle all · alt+r reconfigure · enter save · esc cancel",
      ),
    );
    body.push("");

    // Search input
    const searchPrefix = theme.fg("dim", "filter ❯ ");
    const inputLines = this.input.render(Math.max(10, inner - 10));
    body.push(searchPrefix + (inputLines[0] ?? ""));
    body.push("");

    // List — always render exactly maxRows item rows plus one status row so the
    // overlay's height is stable while the filter narrows results.
    const total = this.filtered.length;
    const start =
      total <= this.maxRows
        ? 0
        : Math.max(
            0,
            Math.min(
              this.cursor - Math.floor(this.maxRows / 2),
              total - this.maxRows,
            ),
          );
    const end = Math.min(start + this.maxRows, total);

    for (let i = start; i < end; i++) {
      const item = this.filtered[i];
      if (!item) continue;
      const isSel = this.selected.has(item.name);
      const isCur = i === this.cursor;
      const box = isSel ? "◉" : "◯";
      const boxColored = isSel
        ? theme.fg("success", box)
        : theme.fg("dim", box);
      const name = isCur ? theme.bold(item.name) : item.name;
      const connectedTag = item.connected
        ? theme.fg("success", " • connected")
        : "";
      const count = theme.fg("dim", `  ${item.actionCount} actions`);
      const arrow = isCur ? theme.fg("accent", "❯ ") : "  ";
      body.push(`${arrow}${boxColored} ${name}${connectedTag}${count}`);
    }
    for (let i = end - start; i < this.maxRows; i++) body.push("");

    body.push(
      total === 0
        ? theme.fg("dim", "  no matches")
        : theme.fg("dim", `  ${this.cursor + 1}/${total}`),
    );

    return this.drawBorder(body, width);
  }

  /**
   * Wrap body lines in a Unicode box border with 1-column horizontal padding.
   * The width of every line is normalized to inner+2 so the right border aligns.
   */
  private drawBorder(body: string[], width: number): string[] {
    const theme = this.theme;
    const inner = Math.max(10, width - 4);
    const top = theme.fg("dim", `╭${"─".repeat(inner + 2)}╮`);
    const bot = theme.fg("dim", `╰${"─".repeat(inner + 2)}╯`);
    const side = theme.fg("dim", "│");
    const out: string[] = [top];
    for (const raw of body) {
      const visible = visibleWidth(raw);
      const pad = Math.max(0, inner - visible);
      out.push(`${side} ${raw}${" ".repeat(pad)} ${side}`);
    }
    out.push(bot);
    return out;
  }

  handleInput(data: string): void {
    // Navigation + toggle keys — check before routing to the text input,
    // otherwise arrow keys and space would just type characters.
    if (data === "\x1b[A" || data === "\x1b[Z") {
      // up / shift-tab
      if (this.filtered.length > 0) {
        this.cursor =
          this.cursor === 0 ? this.filtered.length - 1 : this.cursor - 1;
      }
      return;
    }
    if (data === "\x1b[B" || data === "\t") {
      // down / tab
      if (this.filtered.length > 0) {
        this.cursor =
          this.cursor === this.filtered.length - 1 ? 0 : this.cursor + 1;
      }
      return;
    }
    if (data === " ") {
      const item = this.filtered[this.cursor];
      if (item) {
        if (this.selected.has(item.name)) this.selected.delete(item.name);
        else this.selected.add(item.name);
      }
      return;
    }
    if (data === "\x01") {
      // Ctrl-A — toggle all visible
      const allSelected = this.filtered.every((i) => this.selected.has(i.name));
      for (const i of this.filtered) {
        if (allSelected) this.selected.delete(i.name);
        else this.selected.add(i.name);
      }
      return;
    }
    if (matchesKey(data, Key.alt("r"))) {
      // Alt-R — reconfigure the highlighted plugin if it already has
      // saved credentials. No-op otherwise. (Ctrl-R is reserved by pi
      // for `app.session.rename` and never reaches handleInput.)
      const item = this.filtered[this.cursor];
      if (item?.connected) {
        this.onDone({ reconfigure: item.name });
      }
      return;
    }
    if (data === "\r" || data === "\n") {
      this.confirm();
      return;
    }
    if (data === "\x1b" || data === "\x03") {
      this.cancel();
      return;
    }

    // Everything else → text input (typing filters)
    const before = this.input.getValue();
    this.input.handleInput(data);
    const after = this.input.getValue();
    if (before !== after) {
      this.applyFilter(after);
    }
  }

  private applyFilter(query: string): void {
    this.filtered = query
      ? fuzzyFilter(this.items, query, (i) => i.name)
      : this.items;
    this.cursor = 0;
  }

  private confirm(): void {
    this.onDone({ selected: [...this.selected].sort() });
  }

  private cancel(): void {
    this.onDone({});
  }
}

/** Factory wrapper that matches the ctx.ui.custom signature. */
export function createPluginPickerFactory(
  items: PluginPickerItem[],
  initiallySelected: Iterable<string>,
) {
  return (
    _tui: TUI,
    theme: Theme,
    _keybindings: unknown,
    done: (result: PluginPickerResult) => void,
  ): Component => {
    return new PluginPicker(items, initiallySelected, theme, done);
  };
}
