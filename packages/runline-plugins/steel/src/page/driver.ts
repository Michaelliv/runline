/**
 * Trusted browser input over raw CDP.
 *
 * CDP domains are addressed directly rather than through a browser
 * automation library, because the plugin must work in hosts that have
 * none installed. The events are the real ones — `Input.dispatchMouseEvent`
 * and friends produce `isTrusted` events, so pages that reject synthetic
 * input behave as they do for a person.
 *
 * Targets arrive as a `locatorToken` the page bridge stamped onto the
 * element. Resolving that token to coordinates happens here, immediately
 * before dispatch, so a layout shift between preparation and action is
 * caught rather than clicked through.
 */

import { CdpError, type CdpPage } from "./cdp.js";
import { TARGET_ATTRIBUTE } from "./page-snapshot.js";

export type ClickOptions = {
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
};

export type PreparedTarget = { editable: boolean; locatorToken: string };

export type BrowserDialog = {
  type: string;
  message: string;
  defaultValue: string;
};

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;

/** CDP wants a bitmask; the tools speak in names. */
function modifierMask(modifiers: ClickOptions["modifiers"] = []): number {
  return modifiers.reduce((mask, name) => mask | MODIFIER_BITS[name], 0);
}

type Point = { x: number; y: number };

export class CdpDriver {
  private dialogs: BrowserDialog | null = null;
  private readonly detachDialogs: () => void;

  constructor(private readonly page: CdpPage) {
    // Dialogs block the renderer: every subsequent evaluate would hang
    // until one is handled, so the tools need to see it as a result
    // rather than as a timeout.
    this.detachDialogs = page.onEvent((method, params) => {
      if (method === "Page.javascriptDialogOpening") {
        this.dialogs = {
          type: String(params.type ?? "dialog"),
          message: String(params.message ?? ""),
          defaultValue: String(params.defaultPrompt ?? ""),
        };
      }
      if (method === "Page.javascriptDialogClosed") this.dialogs = null;
    });
  }

  dialog(): BrowserDialog | null {
    return this.dialogs;
  }

  dispose(): void {
    this.detachDialogs();
  }

  async handleDialog(options: {
    accept: boolean;
    promptText?: string;
  }): Promise<void> {
    if (!this.dialogs) {
      throw new CdpError("no_dialog", "No dialog is currently open", false);
    }
    await this.page.send("Page.handleJavaScriptDialog", {
      accept: options.accept,
      ...(options.promptText === undefined
        ? {}
        : { promptText: options.promptText }),
    });
    this.dialogs = null;
  }

  /**
   * Resolve a prepared token to viewport coordinates. Runs in the page so
   * the element's own scroll container is honoured, and fails loudly when
   * the element has gone or moved out of view.
   */
  private async point(target: PreparedTarget): Promise<Point> {
    const box = await this.page.evaluate<
      { x: number; y: number } | { error: string }
    >(`(() => {
      const el = document.querySelector('[${TARGET_ATTRIBUTE}=' + ${JSON.stringify(
        JSON.stringify(target.locatorToken),
      )} + ']');
      if (!el) return { error: 'detached' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return { error: 'not_visible' };
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if ("error" in box) {
      throw box.error === "detached"
        ? new CdpError(
            "stale_ref",
            "The target element left the page between preparing and acting on it. Capture a fresh snapshot and retry.",
          )
        : new CdpError(
            "element_not_visible",
            "The target element is not visible at action time",
          );
    }
    return box;
  }

  private async mouse(
    type: "mousePressed" | "mouseReleased" | "mouseMoved",
    point: Point,
    options: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      modifiers?: number;
    } = {},
  ): Promise<void> {
    await this.page.send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: options.button ?? "left",
      clickCount: options.clickCount ?? 0,
      modifiers: options.modifiers ?? 0,
    });
  }

  async click(target: PreparedTarget, options: ClickOptions): Promise<void> {
    const point = await this.point(target);
    const modifiers = modifierMask(options.modifiers);
    const button = options.button ?? "left";
    await this.mouse("mouseMoved", point, { modifiers });
    const clicks = options.doubleClick ? 2 : 1;
    for (let index = 1; index <= clicks; index += 1) {
      await this.mouse("mousePressed", point, {
        button,
        clickCount: index,
        modifiers,
      });
      await this.mouse("mouseReleased", point, {
        button,
        clickCount: index,
        modifiers,
      });
    }
  }

  async hover(target: PreparedTarget): Promise<void> {
    await this.mouse("mouseMoved", await this.point(target));
  }

  async drag(start: PreparedTarget, end: PreparedTarget): Promise<void> {
    const from = await this.point(start);
    const to = await this.point(end);
    await this.mouse("mouseMoved", from);
    await this.mouse("mousePressed", from, { clickCount: 1 });
    // Intermediate moves: drag handlers commonly ignore a single jump.
    for (let step = 1; step <= 4; step += 1) {
      await this.mouse("mouseMoved", {
        x: from.x + ((to.x - from.x) * step) / 4,
        y: from.y + ((to.y - from.y) * step) / 4,
      });
    }
    await this.mouse("mouseReleased", to, { clickCount: 1 });
  }

  async scroll(deltaY: number, target?: PreparedTarget): Promise<void> {
    const point = target
      ? await this.point(target)
      : await this.viewportCentre();
    await this.page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY,
    });
  }

  private async viewportCentre(): Promise<Point> {
    return await this.page.evaluate<Point>(
      "({ x: window.innerWidth / 2, y: window.innerHeight / 2 })",
    );
  }

  async type(
    target: PreparedTarget,
    text: string,
    options: { slowly?: boolean },
  ): Promise<void> {
    // The bridge already focused the element and set the selection for
    // replace/append, so typing here just replays keys into it.
    if (options.slowly) {
      for (const char of text) await this.insertKey(char);
      return;
    }
    if (text.length === 0) {
      // Replace-mode with empty text means "clear": the selection is
      // set, so a delete is what removes it.
      await this.press("Delete");
      return;
    }
    await this.page.send("Input.insertText", { text });
  }

  private async insertKey(char: string): Promise<void> {
    await this.page.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
      unmodifiedText: char,
    });
    await this.page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      text: char,
    });
  }

  async press(key: string): Promise<void> {
    const parts = key.split("+");
    const main = parts[parts.length - 1] ?? key;
    const modifiers = modifierMask(
      parts.slice(0, -1) as ClickOptions["modifiers"],
    );
    const descriptor = keyDescriptor(main);
    await this.page.send("Input.dispatchKeyEvent", {
      type: descriptor.text ? "keyDown" : "rawKeyDown",
      modifiers,
      ...descriptor,
    });
    await this.page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers,
      ...descriptor,
    });
  }

  async select(target: PreparedTarget, values: string[]): Promise<void> {
    const token = JSON.stringify(target.locatorToken);
    await this.page.evaluate(`(() => {
      const el = document.querySelector('[${TARGET_ATTRIBUTE}=' + ${JSON.stringify(
        token,
      )} + ']');
      if (!el) throw new Error('Select element is no longer attached');
      const wanted = new Set(${JSON.stringify(values)});
      for (const option of el.options) option.selected = wanted.has(option.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async screenshot(options: { fullPage?: boolean }): Promise<{
    data: string;
    mimeType: "image/jpeg";
  }> {
    const params: Record<string, unknown> = {
      format: "jpeg",
      quality: 80,
    };
    if (options.fullPage) params.captureBeyondViewport = true;
    const result = (await this.page.send("Page.captureScreenshot", params)) as {
      data: string;
    };
    return { data: result.data, mimeType: "image/jpeg" };
  }

  /** Let the page react to the action before it is snapshotted. */
  async settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (this.dialogs) return;
    await this.page
      .evaluate(
        `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
      )
      .catch(() => {
        // A navigation or dialog can tear down the world mid-settle;
        // the caller's snapshot reports the real state either way.
      });
  }
}

/**
 * CDP needs `key`/`code`/`windowsVirtualKeyCode` for non-printable keys;
 * printable ones also need `text` or they arrive as bare keydowns.
 */
function keyDescriptor(key: string): Record<string, unknown> {
  const named: Record<string, { code: string; keyCode: number }> = {
    Enter: { code: "Enter", keyCode: 13 },
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Backspace: { code: "Backspace", keyCode: 8 },
    Delete: { code: "Delete", keyCode: 46 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
    PageUp: { code: "PageUp", keyCode: 33 },
    PageDown: { code: "PageDown", keyCode: 34 },
    Space: { code: "Space", keyCode: 32 },
  };
  const match = named[key];
  if (match) {
    return {
      key: key === "Space" ? " " : key,
      code: match.code,
      windowsVirtualKeyCode: match.keyCode,
      ...(key === "Enter" ? { text: "\r" } : {}),
      ...(key === "Space" ? { text: " " } : {}),
    };
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return {
      key,
      code: /[a-z]/i.test(key) ? `Key${upper}` : `Digit${key}`,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      text: key,
      unmodifiedText: key,
    };
  }
  return { key };
}
