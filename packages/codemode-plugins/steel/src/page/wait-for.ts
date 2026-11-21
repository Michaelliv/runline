export type WaitOutcome = {
  matched: boolean;
  timedOut: boolean;
  elapsedMs: number;
};

export type WaitRequest = { text?: string; textGone?: string; time?: number };

export async function waitForPage(
  document: Document,
  request: WaitRequest,
  options: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<WaitOutcome> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    (async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  const timeoutMs = Math.min(30, Math.max(0, request.time ?? 5)) * 1_000;
  const started = now();

  if (!request.text && !request.textGone) {
    await sleep(timeoutMs);
    return {
      matched: true,
      timedOut: false,
      elapsedMs: Math.max(0, now() - started),
    };
  }

  while (true) {
    const text = document.body?.innerText ?? document.body?.textContent ?? "";
    const found = !request.text || text.includes(request.text);
    const gone = !request.textGone || !text.includes(request.textGone);
    const elapsedMs = Math.max(0, now() - started);
    if (found && gone) {
      return { matched: true, timedOut: false, elapsedMs };
    }
    if (elapsedMs >= timeoutMs) {
      return { matched: false, timedOut: true, elapsedMs };
    }
    await sleep(Math.min(100, timeoutMs - elapsedMs));
  }
}
