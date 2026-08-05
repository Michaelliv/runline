/**
 * The in-page half of the Steel page tools.
 *
 * This module is bundled (see `scripts/build-steel-page-bundle.ts`) into
 * one self-contained IIFE and evaluated inside the Steel session's page.
 * Everything here is pure DOM code — it never sees the Steel API key, the
 * CDP socket, or any plugin state.
 *
 * Why a resident global rather than a fresh evaluate per call: element
 * refs (`e12`) are only stable while the aria-snapshot module's counter
 * and each element's cached `_ariaRef` survive between calls. A new
 * bundle per call would renumber every element and silently invalidate
 * refs the agent is holding. So the bundle installs itself once per
 * execution context and the driver re-injects only when the world is
 * gone — which is exactly navigation, where fresh refs are correct.
 */

import {
  type EditableMode,
  PageSnapshotService,
  BrowserToolError,
} from "./page-snapshot.js";
import { waitForPage, type WaitRequest } from "./wait-for.js";

/** Bumped when the in-page contract changes, so a stale world is replaced. */
export const PAGE_BRIDGE_VERSION = 1;
export const PAGE_BRIDGE_GLOBAL = "__steelPageBridge";

type Ok = { ok: true; value: unknown };
type Err = {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};

export type PageBridgeRequest =
  | { action: "snapshot"; depth?: number; boxes?: boolean; maxChars?: number }
  | { action: "prepare_target"; target: string }
  | { action: "prepare_editable"; target: string; mode: EditableMode }
  | { action: "editable_value"; target: string }
  | { action: "resolve_options"; target: string; values: string[] }
  | ({ action: "wait_for" } & WaitRequest);

export type PageBridge = {
  version: number;
  handle(request: PageBridgeRequest): Promise<Ok | Err>;
};

export function createPageBridge(document: Document): PageBridge {
  let service = new PageSnapshotService(document);
  let maxChars: number | undefined;

  return {
    version: PAGE_BRIDGE_VERSION,
    async handle(request: PageBridgeRequest): Promise<Ok | Err> {
      try {
        return { ok: true, value: await dispatch(request) };
      } catch (error) {
        if (error instanceof BrowserToolError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "page_error",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        };
      }
    },
  };

  async function dispatch(request: PageBridgeRequest): Promise<unknown> {
    switch (request.action) {
      case "snapshot": {
        // maxChars is a construction option upstream; honour a per-call
        // override by rebuilding rather than reaching into the service.
        if (request.maxChars !== undefined && request.maxChars !== maxChars) {
          maxChars = request.maxChars;
          service = new PageSnapshotService(document, { maxChars });
        }
        return service.capture({
          ...(request.depth !== undefined ? { depth: request.depth } : {}),
          ...(request.boxes !== undefined ? { boxes: request.boxes } : {}),
        });
      }
      case "prepare_target":
        return await service.prepareTarget(request.target);
      case "prepare_editable":
        return await service.prepareEditableTarget(
          request.target,
          request.mode,
        );
      case "editable_value":
        return service.readEditableValue(request.target);
      case "resolve_options":
        return { selected: service.resolveOptions(request.target, request.values) };
      case "wait_for":
        return await waitForPage(document, request);
    }
  }
}

declare global {
  interface Window {
    [PAGE_BRIDGE_GLOBAL]?: PageBridge;
  }
}

/**
 * Install idempotently. Re-evaluating the bundle in a world that already
 * has a current bridge must not reset the ref counter.
 */
export function installPageBridge(): PageBridge {
  const existing = (globalThis as Record<string, unknown>)[PAGE_BRIDGE_GLOBAL] as
    | PageBridge
    | undefined;
  if (existing?.version === PAGE_BRIDGE_VERSION) return existing;
  const bridge = createPageBridge(document);
  (globalThis as Record<string, unknown>)[PAGE_BRIDGE_GLOBAL] = bridge;
  return bridge;
}
