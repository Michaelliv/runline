/**
 * A minimal Chrome DevTools Protocol client over the Steel session's
 * websocket, and the page-bridge channel built on top of it.
 *
 * This exists because the Steel plugin cannot assume Playwright: the host
 * app may not have it installed, and quietly substituting a lookalike is
 * what made `browser.run` report wrong results instead of failing. Here
 * the dependency is the protocol itself, which Steel always speaks.
 *
 * Scope is deliberate. This is not a browser automation library — it is
 * the transport for two things: evaluating the page bridge, and
 * dispatching trusted input. Anything richer belongs in the page bridge,
 * where it is ordinary DOM code.
 */

import {
  PAGE_BRIDGE_GLOBAL,
  PAGE_BRIDGE_SOURCE,
  PAGE_BRIDGE_VERSION,
} from "./bundle.generated.js";

const CONNECT_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 30_000;

export class CdpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "CdpError";
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type CdpEventHandler = (
  method: string,
  params: Record<string, unknown>,
) => void;

export interface CdpConnection {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  on(handler: CdpEventHandler): () => void;
  close(): void;
}

/** Connect to a CDP endpoint and resolve once the socket is open. */
export async function connectCdp(url: string): Promise<CdpConnection> {
  const ws = new WebSocket(url);
  const pending = new Map<number, Pending>();
  const handlers = new Set<CdpEventHandler>();
  let nextId = 0;
  let closed: Error | null = null;

  const failAll = (error: Error) => {
    closed = error;
    for (const [id, wait] of pending) {
      clearTimeout(wait.timer);
      pending.delete(id);
      wait.reject(error);
    }
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new CdpError(
            "cdp_unavailable",
            `Timed out connecting to the browser after ${CONNECT_TIMEOUT_MS}ms`,
          ),
        ),
      CONNECT_TIMEOUT_MS,
    );
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(
          new CdpError("cdp_unavailable", "Could not connect to the browser"),
        );
      },
      { once: true },
    );
  });

  ws.addEventListener("close", () =>
    failAll(new CdpError("cdp_closed", "The browser connection closed")),
  );

  ws.addEventListener("message", (event) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const wait = pending.get(message.id);
      if (!wait) return;
      clearTimeout(wait.timer);
      pending.delete(message.id);
      if (message.error) {
        const error = message.error as { message?: string };
        wait.reject(
          new CdpError("cdp_command_failed", error.message ?? "CDP error"),
        );
      } else {
        wait.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method === "string") {
      for (const handler of handlers) {
        handler(message.method, (message.params ?? {}) as Record<string, unknown>);
      }
    }
  });

  return {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(closed);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CdpError("cdp_timeout", `${method} timed out`));
        }, COMMAND_TIMEOUT_MS);
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
        });
        ws.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      failAll(new CdpError("cdp_closed", "The browser connection was closed"));
      try {
        ws.close();
      } catch {
        // Already closing; nothing to recover.
      }
    },
  };
}

export type BridgeFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

/**
 * One attached page target, with the page bridge kept installed on it.
 */
export class CdpPage {
  constructor(
    private readonly cdp: CdpConnection,
    readonly targetId: string,
    readonly sessionId: string,
  ) {}

  send(method: string, params: Record<string, unknown> = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  /** Subscribe to this page's protocol events; returns an unsubscribe. */
  onEvent(handler: (method: string, params: Record<string, unknown>) => void) {
    return this.cdp.on((method, params) => {
      if (params.sessionId && params.sessionId !== this.sessionId) return;
      handler(method, params);
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new CdpError(
        "page_error",
        detail.exception?.description ?? detail.text ?? "Page evaluation failed",
      );
    }
    return result.result?.value as T;
  }

  /**
   * Call the page bridge, installing it first when the world does not
   * have it. Navigation destroys the world, so this self-heals rather
   * than requiring callers to track page lifetime.
   */
  async bridge<T>(request: Record<string, unknown>): Promise<T> {
    let response = await this.callBridge<T>(request);
    if (response === undefined) {
      await this.installBridge();
      response = await this.callBridge<T>(request);
    }
    if (response === undefined) {
      throw new CdpError(
        "page_unavailable",
        "The page bridge did not install; the page may have navigated mid-action",
      );
    }
    const outcome = response as
      | { ok: true; value: T }
      | { ok: false; error: BridgeFailure };
    if (!outcome.ok) {
      throw new CdpError(
        outcome.error.code,
        outcome.error.message,
        outcome.error.retryable,
      );
    }
    return outcome.value;
  }

  private async callBridge<T>(
    request: Record<string, unknown>,
  ): Promise<T | undefined> {
    return await this.evaluate<T | undefined>(
      `(() => {
        const bridge = window[${JSON.stringify(PAGE_BRIDGE_GLOBAL)}];
        if (!bridge || bridge.version !== ${PAGE_BRIDGE_VERSION}) return undefined;
        return bridge.handle(${JSON.stringify(request)});
      })()`,
    );
  }

  async installBridge(): Promise<void> {
    await this.evaluate(PAGE_BRIDGE_SOURCE);
  }

  /**
   * Install the bridge on every future document too. Without this the
   * first call after any navigation pays a reinstall round trip, and a
   * page that navigates itself mid-action could be observed bridgeless.
   */
  async installOnNewDocuments(): Promise<void> {
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: PAGE_BRIDGE_SOURCE,
    });
  }
}

/** Attach to the session's page target, preferring the active one. */
export async function attachToPage(cdp: CdpConnection): Promise<CdpPage> {
  const { targetInfos } = (await cdp.send("Target.getTargets")) as {
    targetInfos?: Array<{ targetId: string; type: string; attached?: boolean }>;
  };
  const pages = (targetInfos ?? []).filter((info) => info.type === "page");
  const target = pages[0];
  if (!target) {
    throw new CdpError(
      "page_unavailable",
      "The browser session has no page to control",
      false,
    );
  }
  return await attachToTarget(cdp, target.targetId);
}

export async function attachToTarget(
  cdp: CdpConnection,
  targetId: string,
): Promise<CdpPage> {
  const { sessionId } = (await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })) as { sessionId: string };
  const page = new CdpPage(cdp, targetId, sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("DOM.enable");
  // Needed before cookies can be written on the target.
  await page.send("Network.enable");
  await page.installOnNewDocuments();
  await page.installBridge();
  return page;
}
