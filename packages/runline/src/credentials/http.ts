import { AuthError } from "../auth/errors.js";
import type { HttpMethod } from "./types.js";

export interface ResourceOptions {
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  resumableUpload?: boolean;
}

/** Internal send primitive. Callers validate destination policy before reaching it. */
export async function sendResource(
  url: string,
  method: HttpMethod,
  headers: Headers,
  body: Buffer | undefined,
  options: ResourceOptions,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuthError("transport_failed"));
    }, options.timeoutMs);
  });
  const work = async () => {
    const response = await options.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : Buffer.from(body),
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      response.redirected ||
      (response.status >= 300 &&
        response.status < 400 &&
        !(
          options.resumableUpload &&
          method === "PUT" &&
          headers.has("content-range") &&
          response.status === 308 &&
          !response.headers.has("location")
        ))
    ) {
      void response.body?.cancel().catch(() => {});
      throw new AuthError("transport_failed");
    }
    const reader = response.body?.getReader();
    const cancel = () => {
      void reader?.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > options.maxResponseBytes) {
            void reader.cancel().catch(() => {});
            throw new AuthError("response_too_large");
          }
          if (value.byteLength) chunks.push(value);
        }
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      reader?.releaseLock();
    }
    const responseHeaders = new Headers(response.headers);
    // Fetch supplies decoded bytes, not the original wire representation.
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("set-cookie");
    return new Response(
      method === "HEAD" || [204, 205, 304].includes(response.status)
        ? null
        : Buffer.concat(chunks),
      { status: response.status, headers: responseHeaders },
    );
  };
  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    if (error instanceof AuthError && error.code === "response_too_large")
      throw error;
    throw new AuthError("transport_failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a provider-issued preauthenticated URL without bearer tokens or cookies.
 * Hosts approve exact origins and enforce DNS/IP egress through their fetch hook.
 * The signed URL is itself secret: errors never include it. No redirects or retries.
 */
export async function downloadResource(
  value: string,
  options: {
    allowedOrigins: string[];
    fetch: typeof globalThis.fetch;
    maxResponseBytes?: number;
  },
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !options.allowedOrigins.includes(url.origin)
    )
      throw new Error();
  } catch {
    throw new AuthError("request_not_allowed");
  }
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > 64 * 1024 * 1024
  )
    throw new AuthError("invalid_definition");
  return sendResource(url.toString(), "GET", new Headers(), undefined, {
    fetch: options.fetch,
    timeoutMs: 20_000,
    maxResponseBytes,
  });
}
