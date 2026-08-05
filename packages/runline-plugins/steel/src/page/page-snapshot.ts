import {
  type AriaSnapshot,
  generateAriaTree,
  renderAriaTree,
  SENSITIVE_VALUE_MARKER,
} from "./vendor/aria-snapshot/ariaSnapshot.js";

export { SENSITIVE_VALUE_MARKER };

const ARIA_REF = /^(?:f\d+)?e\d+$/;
const DEFAULT_MAX_CHARS = 60_000;
export const TARGET_ATTRIBUTE = "data-steel-page-target";

export type PageSnapshot = {
  url: string;
  title: string;
  snapshot: string;
  scroll: { y: number; max: number };
  truncated: boolean;
  omittedChars: number;
};

export type PreparedTarget = {
  editable: boolean;
  locatorToken: string;
};

export type EditableMode = "replace" | "append";

export type EditableValue = {
  value: string;
  sensitive: boolean;
};

export type PreparedEditableTarget = PreparedTarget & {
  previousValue: string;
  sensitive: boolean;
  selectionPrepared: boolean;
};

/**
 * Tokens only need to be unique within this document for the moment
 * between preparing a target and acting on it, so a counter suffices.
 * Deliberately not `crypto.randomUUID`: that requires a secure context
 * and is simply absent on plain-http pages, where automation still has
 * to work.
 */
let locatorCounter = 0;
function nextLocatorToken(): string {
  locatorCounter += 1;
  return `t${Date.now().toString(36)}-${locatorCounter}`;
}

export class BrowserToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "BrowserToolError";
  }
}

/**
 * Owns the latest Playwright-style aria snapshot for one document and resolves
 * its refs back to live elements. A ref is never resolved from stale state:
 * resolve() regenerates the tree first, so a detached or semantically renamed
 * target fails instead of operating on the wrong element.
 */
export class PageSnapshotService {
  private current: AriaSnapshot | null = null;
  private readonly maxChars: number;
  private readonly refPrefix?: string;

  constructor(
    private readonly document: Document,
    options: { maxChars?: number; refPrefix?: string } = {},
  ) {
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.refPrefix = options.refPrefix;
  }

  capture(options: { depth?: number; boxes?: boolean } = {}): PageSnapshot {
    this.clearPreparedTargets();
    return this.captureCurrent(options);
  }

  private captureCurrent(
    options: { depth?: number; boxes?: boolean } = {},
  ): PageSnapshot {
    const root = this.document.body ?? this.document.documentElement;
    if (!root) {
      throw new BrowserToolError(
        "page_unavailable",
        "The page has no document root",
      );
    }

    this.current = generateAriaTree(root, {
      mode: "ai",
      refPrefix: this.refPrefix,
      depth: options.depth,
      boxes: options.boxes,
    });
    const rendered = renderAriaTree(this.current, {
      mode: "ai",
      depth: options.depth,
      boxes: options.boxes,
    }).text;
    const snapshot = truncateAtLine(rendered, this.maxChars);
    const view = this.document.defaultView;
    const documentElement = this.document.documentElement;
    const body = this.document.body;
    const scrollHeight = Math.max(
      documentElement?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
    );
    const viewportHeight =
      view?.visualViewport?.height ??
      documentElement?.clientHeight ??
      view?.innerHeight ??
      0;

    return {
      url: this.document.location?.href ?? "",
      title: this.document.title,
      snapshot: snapshot.text,
      scroll: {
        y: Math.round(view?.scrollY ?? documentElement?.scrollTop ?? 0),
        max: Math.max(0, Math.round(scrollHeight - viewportHeight)),
      },
      truncated: snapshot.omittedChars > 0,
      omittedChars: snapshot.omittedChars,
    };
  }

  resolveOptions(target: string, values: string[]): string[] {
    const element = this.resolve(target);
    if (!(element instanceof HTMLSelectElement)) {
      throw new BrowserToolError(
        "element_not_select",
        `Target ${target} is not a select element`,
        false,
      );
    }
    const requested = new Set(values);
    const matched = new Set<string>();
    const selected: string[] = [];
    for (const option of element.options) {
      const aliases = [option.value, option.label, option.text];
      const matches = aliases.filter((value) => requested.has(value));
      if (matches.length > 0) {
        selected.push(option.value);
        for (const match of matches) matched.add(match);
      }
    }
    if (matched.size !== requested.size) {
      throw new BrowserToolError(
        "option_not_found",
        `Could not match all requested options: ${values.join(", ")}`,
      );
    }
    return selected;
  }

  async prepareTarget(
    target: string,
    options: { stabilityIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<PreparedTarget> {
    const element = this.resolve(target);
    if (isDisabled(element)) {
      throw new BrowserToolError(
        "element_disabled",
        `Target ${target} is disabled`,
      );
    }

    element.scrollIntoView?.({ block: "center", inline: "center" });
    const rect = await stableRect(element, options);
    if (!rect || rect.width <= 0 || rect.height <= 0 || !isVisible(element)) {
      throw new BrowserToolError(
        "element_not_visible",
        `Target ${target} is not visible`,
      );
    }

    const center = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    const hit = this.document.elementFromPoint?.(center.x, center.y);
    if (hit && !belongsToTarget(hit, element)) {
      throw new BrowserToolError(
        "element_obscured",
        `Target ${target} is covered by another element`,
      );
    }

    const locatorToken = nextLocatorToken();
    element.setAttribute(TARGET_ATTRIBUTE, locatorToken);
    return {
      editable: isEditable(element),
      locatorToken,
    };
  }

  async prepareEditableTarget(
    target: string,
    mode: EditableMode,
    options: { stabilityIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<PreparedEditableTarget> {
    const prepared = await this.prepareTarget(target, options);
    if (!prepared.editable) {
      throw new BrowserToolError(
        "element_not_editable",
        `Target ${target} does not accept text input`,
        false,
      );
    }
    const element = this.preparedElement(prepared.locatorToken);
    const previous = editableValue(element);
    return {
      ...prepared,
      previousValue: previous.value,
      sensitive: previous.sensitive,
      selectionPrepared: prepareEditableSelection(element, mode),
    };
  }

  readEditableValue(target: string): EditableValue {
    const element = this.resolve(target);
    if (!hasEditableValue(element)) {
      throw new BrowserToolError(
        "element_not_editable",
        `Target ${target} does not have an editable text value`,
        false,
      );
    }
    return editableValue(element);
  }

  private preparedElement(locatorToken: string): Element {
    const element = this.document.querySelector(
      `[${TARGET_ATTRIBUTE}="${locatorToken}"]`,
    );
    if (!element) {
      throw new BrowserToolError(
        "stale_ref",
        "Prepared browser target is no longer attached",
      );
    }
    return element;
  }

  private clearPreparedTargets(): void {
    for (const element of this.document.querySelectorAll(
      `[${TARGET_ATTRIBUTE}]`,
    )) {
      element.removeAttribute(TARGET_ATTRIBUTE);
    }
  }

  resolve(target: string): Element {
    const normalized = target.trim();
    if (!normalized) {
      throw new BrowserToolError(
        "element_not_found",
        "Element target cannot be empty",
      );
    }

    if (ARIA_REF.test(normalized)) {
      this.captureCurrent();
      const element = this.current?.info.get(normalized)?.element;
      if (!element?.isConnected) {
        throw new BrowserToolError(
          "stale_ref",
          `Ref ${normalized} is not present in the current page snapshot. Capture a fresh snapshot and retry.`,
        );
      }
      return element;
    }

    let matches: NodeListOf<Element>;
    try {
      matches = this.document.querySelectorAll(normalized);
    } catch {
      throw new BrowserToolError(
        "element_not_found",
        `Invalid element selector: ${normalized}`,
        false,
      );
    }
    if (matches.length === 0) {
      throw new BrowserToolError(
        "element_not_found",
        `Selector ${JSON.stringify(normalized)} did not match any elements`,
      );
    }
    if (matches.length > 1) {
      throw new BrowserToolError(
        "ambiguous_target",
        `Selector ${JSON.stringify(normalized)} matched ${matches.length} elements; use an exact ref from browser_read_page`,
      );
    }
    return matches[0];
  }
}

function isEditable(element: Element): boolean {
  if (!hasEditableValue(element)) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) return !element.readOnly;
  return true;
}

function hasEditableValue(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function editableValue(element: Element): EditableValue {
  if (element instanceof HTMLInputElement) {
    return { value: element.value, sensitive: element.type === "password" };
  }
  if (element instanceof HTMLTextAreaElement) {
    return { value: element.value, sensitive: false };
  }
  const html = element as HTMLElement;
  return {
    value:
      typeof html.innerText === "string"
        ? html.innerText
        : (html.textContent ?? ""),
    sensitive: false,
  };
}

function prepareEditableSelection(
  element: Element,
  mode: EditableMode,
): boolean {
  const html = element as HTMLElement;
  html.focus({ preventScroll: true });

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    try {
      if (mode === "replace") element.select();
      else
        element.setSelectionRange(element.value.length, element.value.length);
      return (
        element.selectionStart ===
          (mode === "replace" ? 0 : element.value.length) &&
        element.selectionEnd === element.value.length
      );
    } catch {
      return false;
    }
  }

  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  if (mode === "append") range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function isDisabled(element: Element): boolean {
  const nativeDisabled =
    "disabled" in element &&
    (element as Element & { disabled?: boolean }).disabled === true;
  return nativeDisabled || element.getAttribute("aria-disabled") === "true";
}

function isVisible(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.visibility !== "collapse" &&
    style?.opacity !== "0"
  );
}

async function stableRect(
  element: Element,
  options: { stabilityIntervalMs?: number; timeoutMs?: number },
): Promise<DOMRect | null> {
  const interval = options.stabilityIntervalMs;
  const timeout = options.timeoutMs ?? 1_000;
  const started = Date.now();
  let previous: DOMRect | null = null;

  while (Date.now() - started <= timeout) {
    const current = element.getBoundingClientRect();
    if (!element.isConnected) return null;
    if (previous && rectsEqual(previous, current)) return current;
    previous = current;
    await nextLayoutFrame(element.ownerDocument.defaultView, interval);
  }
  throw new BrowserToolError(
    "element_unstable",
    "Target element did not settle before the action timeout",
  );
}

async function nextLayoutFrame(
  view: Window | null,
  interval: number | undefined,
): Promise<void> {
  if (interval !== undefined || !view?.requestAnimationFrame) {
    await new Promise((resolve) => setTimeout(resolve, interval ?? 50));
    return;
  }
  await new Promise<void>((resolve) =>
    view.requestAnimationFrame(() => resolve()),
  );
}

function rectsEqual(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function belongsToTarget(hit: Element, target: Element): boolean {
  if (hit === target || target.contains(hit)) return true;
  let current: Node | null = hit;
  while (current) {
    const root = current.getRootNode();
    if (!(root instanceof ShadowRoot)) return false;
    if (root.host === target || target.contains(root.host)) return true;
    current = root.host;
  }
  return false;
}

function truncateAtLine(
  text: string,
  maxChars: number,
): { text: string; omittedChars: number } {
  if (text.length <= maxChars) return { text, omittedChars: 0 };
  const cut = text.lastIndexOf("\n", Math.max(0, maxChars));
  const end = cut > 0 ? cut : maxChars;
  return {
    text: text.slice(0, end),
    omittedChars: text.length - end,
  };
}
