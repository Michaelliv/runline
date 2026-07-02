import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.airtop.ai/api/v1";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(
    endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`,
  );
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtop API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

async function pollUntil(
  apiKey: string,
  endpoint: string,
  statusField: string,
  targetStatuses: string[],
  timeoutMs: number,
  intervalMs = 1000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (true) {
    const data = (await apiRequest(apiKey, "GET", endpoint)) as Record<
      string,
      unknown
    >;
    const nested = data.data as Record<string, unknown> | undefined;
    const status = (nested?.[statusField] ?? data[statusField]) as string;
    if (targetStatuses.includes(status)) return data;
    if (Date.now() - start > timeoutMs)
      throw new Error("Timeout reached waiting for status change");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function airtop(rl: RunlinePluginAPI) {
  rl.setName("airtop");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Airtop API key",
      env: "AIRTOP_API_KEY",
    },
  });

  // ── Session ─────────────────────────────────────────

  rl.registerAction("session.create", {
    access: "write",
    description: "Create a new browser session and wait until it's running",
    inputSchema: {
      profileName: {
        type: "string",
        required: false,
        description: "Browser profile name",
      },
      timeoutMinutes: {
        type: "number",
        required: false,
        description: "Idle timeout in minutes (default 10)",
      },
      proxy: {
        type: "boolean",
        required: false,
        description: "Enable Airtop proxy",
      },
      proxyCountry: {
        type: "string",
        required: false,
        description: "Proxy country code (e.g. US)",
      },
      record: {
        type: "boolean",
        required: false,
        description: "Record the session",
      },
      solveCaptcha: {
        type: "boolean",
        required: false,
        description: "Auto-solve captchas",
      },
      saveProfileOnTermination: {
        type: "boolean",
        required: false,
        description: "Save profile when session ends",
      },
    },
    async execute(input, ctx) {
      const {
        profileName,
        timeoutMinutes = 10,
        proxy,
        proxyCountry,
        record,
        solveCaptcha,
        saveProfileOnTermination,
      } = (input ?? {}) as Record<string, unknown>;
      const apiKey = getKey(ctx);

      let proxyConfig: unknown = false;
      if (proxy) {
        proxyConfig = proxyCountry
          ? { country: proxyCountry, sticky: true }
          : true;
      }

      const body: Record<string, unknown> = {
        configuration: {
          profileName: profileName ?? "",
          timeoutMinutes,
          proxy: proxyConfig,
          solveCaptcha: solveCaptcha ?? false,
          record: record ?? false,
        },
      };

      const response = (await apiRequest(
        apiKey,
        "POST",
        "/sessions",
        body,
      )) as Record<string, unknown>;
      const sessionId = (response.data as Record<string, unknown>)
        ?.id as string;
      if (!sessionId) throw new Error("Failed to create session");

      // Poll until running
      await pollUntil(
        apiKey,
        `/sessions/${sessionId}`,
        "status",
        ["running"],
        5 * 60 * 1000,
      );

      if (saveProfileOnTermination && profileName) {
        await apiRequest(
          apiKey,
          "PUT",
          `/sessions/${sessionId}/save-profile-on-termination/${profileName}`,
        );
      }

      return { sessionId, ...response };
    },
  });

  rl.registerAction("session.terminate", {
    access: "write",
    description: "Terminate a browser session",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
    },
    async execute(input, ctx) {
      const { sessionId } = input as { sessionId: string };
      await apiRequest(getKey(ctx), "DELETE", `/sessions/${sessionId}`);
      return { success: true };
    },
  });

  rl.registerAction("session.save", {
    access: "write",
    description: "Save a browser profile on session termination",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      profileName: {
        type: "string",
        required: true,
        description: "Profile name to save",
      },
    },
    async execute(input, ctx) {
      const { sessionId, profileName } = input as {
        sessionId: string;
        profileName: string;
      };
      const response = await apiRequest(
        getKey(ctx),
        "PUT",
        `/sessions/${sessionId}/save-profile-on-termination/${profileName}`,
      );
      return {
        sessionId,
        profileName,
        ...(response as Record<string, unknown>),
      };
    },
  });

  rl.registerAction("session.waitForDownload", {
    access: "read",
    description: "Wait for a file download to become available in a session",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      timeoutSeconds: {
        type: "number",
        required: false,
        description: "Timeout in seconds (default 30)",
      },
    },
    async execute(input, ctx) {
      const { sessionId, timeoutSeconds = 30 } = input as {
        sessionId: string;
        timeoutSeconds?: number;
      };
      // This relies on SSE which we can't do cleanly in a plugin action.
      // Fall back to polling the files endpoint.
      const apiKey = getKey(ctx);
      const start = Date.now();
      while (Date.now() - start < timeoutSeconds * 1000) {
        const data = (await apiRequest(apiKey, "GET", "/files", undefined, {
          sessionIds: sessionId,
        })) as Record<string, unknown>;
        const files =
          ((data.data as Record<string, unknown>)?.files as Array<
            Record<string, unknown>
          >) ?? [];
        const available = files.find((f) => f.status === "available");
        if (available)
          return {
            sessionId,
            fileId: available.id,
            downloadUrl: available.downloadUrl,
          };
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("Timeout waiting for download");
    },
  });

  // ── Window ──────────────────────────────────────────

  rl.registerAction("window.create", {
    access: "write",
    description: "Create a new browser window in a session",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      url: {
        type: "string",
        required: false,
        description: "Initial URL to load (default: google.com)",
      },
      waitUntil: {
        type: "string",
        required: false,
        description: "Wait event: load, domContentLoaded, complete, noWait",
      },
    },
    async execute(input, ctx) {
      const { sessionId, url, waitUntil } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (url) body.url = url;
      if (waitUntil) body.waitUntil = waitUntil;
      const response = (await apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows`,
        body,
      )) as Record<string, unknown>;
      const windowId = (response.data as Record<string, unknown>)
        ?.windowId as string;
      return { sessionId, windowId, ...response };
    },
  });

  rl.registerAction("window.close", {
    access: "write",
    description: "Close a browser window",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
    },
    async execute(input, ctx) {
      const { sessionId, windowId } = input as {
        sessionId: string;
        windowId: string;
      };
      const response = await apiRequest(
        getKey(ctx),
        "DELETE",
        `/sessions/${sessionId}/windows/${windowId}`,
      );
      return { sessionId, windowId, ...(response as Record<string, unknown>) };
    },
  });

  rl.registerAction("window.load", {
    access: "write",
    description: "Navigate a window to a URL",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      url: {
        type: "string",
        required: true,
        description: "URL to navigate to",
      },
      waitUntil: {
        type: "string",
        required: false,
        description: "Wait event: load, domContentLoaded, complete, noWait",
      },
    },
    async execute(input, ctx) {
      const { sessionId, windowId, url, waitUntil } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { url };
      if (waitUntil) body.waitUntil = waitUntil;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}`,
        body,
      );
    },
  });

  rl.registerAction("window.list", {
    access: "read",
    description: "List all windows in a session",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
    },
    async execute(input, ctx) {
      const { sessionId } = input as { sessionId: string };
      return apiRequest(getKey(ctx), "GET", `/sessions/${sessionId}/windows`);
    },
  });

  rl.registerAction("window.getLiveView", {
    access: "read",
    description: "Get the live view URL for a window",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      includeNavigationBar: {
        type: "boolean",
        required: false,
        description: "Show nav bar in live view",
      },
      screenResolution: {
        type: "string",
        required: false,
        description: "Screen resolution (e.g. 1280x720)",
      },
      disableResize: {
        type: "boolean",
        required: false,
        description: "Disable window resize",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        includeNavigationBar,
        screenResolution,
        disableResize,
      } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (includeNavigationBar) qs.includeNavigationBar = true;
      if (screenResolution) qs.screenResolution = screenResolution;
      if (disableResize) qs.disableResize = true;
      return apiRequest(
        getKey(ctx),
        "GET",
        `/sessions/${sessionId}/windows/${windowId}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("window.takeScreenshot", {
    access: "write",
    description: "Take a screenshot of a window (returns base64 data URL)",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
    },
    async execute(input, ctx) {
      const { sessionId, windowId } = input as {
        sessionId: string;
        windowId: string;
      };
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/screenshot`,
      );
    },
  });

  // ── Extraction ──────────────────────────────────────

  rl.registerAction("extraction.query", {
    access: "write",
    description: "Query page content using a natural language prompt",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      prompt: {
        type: "string",
        required: true,
        description: "Natural language prompt to query the page",
      },
      outputSchema: {
        type: "string",
        required: false,
        description: "JSON schema for structured output",
      },
      includeVisualAnalysis: {
        type: "boolean",
        required: false,
        description: "Analyze page visually",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        prompt,
        outputSchema,
        includeVisualAnalysis,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        prompt,
        configuration: {
          experimental: {
            includeVisualAnalysis: includeVisualAnalysis
              ? "enabled"
              : "disabled",
          },
          ...(outputSchema ? { outputSchema } : {}),
        },
      };
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/page-query`,
        body,
      );
    },
  });

  rl.registerAction("extraction.scrape", {
    access: "write",
    description: "Scrape the content of the current page",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
    },
    async execute(input, ctx) {
      const { sessionId, windowId } = input as {
        sessionId: string;
        windowId: string;
      };
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/scrape-content`,
        {},
      );
    },
  });

  rl.registerAction("extraction.getPaginated", {
    access: "write",
    description: "Extract data across paginated pages using a prompt",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      prompt: {
        type: "string",
        required: true,
        description: "Prompt describing what to extract",
      },
      outputSchema: {
        type: "string",
        required: false,
        description: "JSON schema for structured output",
      },
      paginationMode: {
        type: "string",
        required: false,
        description: "auto, paginated, or infinite-scroll",
      },
      interactionMode: {
        type: "string",
        required: false,
        description: "auto, accurate, or cost-efficient",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        prompt,
        outputSchema,
        paginationMode,
        interactionMode,
      } = input as Record<string, unknown>;
      const configuration: Record<string, unknown> = {};
      if (outputSchema) configuration.outputSchema = outputSchema;
      if (paginationMode) configuration.paginationMode = paginationMode;
      if (interactionMode) configuration.interactionMode = interactionMode;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/paginated-extraction`,
        { prompt, configuration },
      );
    },
  });

  // ── Interaction ─────────────────────────────────────

  rl.registerAction("interaction.click", {
    access: "write",
    description: "Click on an element described in natural language",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      elementDescription: {
        type: "string",
        required: true,
        description: "Natural language description of the element to click",
      },
      clickType: {
        type: "string",
        required: false,
        description: "click, doubleClick, or rightClick (default: click)",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        elementDescription,
        clickType = "click",
      } = input as Record<string, unknown>;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/click`,
        {
          elementDescription,
          configuration: { clickType },
        },
      );
    },
  });

  rl.registerAction("interaction.hover", {
    access: "write",
    description: "Hover over an element described in natural language",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      elementDescription: {
        type: "string",
        required: true,
        description: "Natural language description of the element to hover",
      },
    },
    async execute(input, ctx) {
      const { sessionId, windowId, elementDescription } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/hover`,
        {
          elementDescription,
        },
      );
    },
  });

  rl.registerAction("interaction.type", {
    access: "write",
    description:
      "Type text into a browser window, optionally targeting a specific element",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      text: { type: "string", required: true, description: "Text to type" },
      elementDescription: {
        type: "string",
        required: false,
        description: "Element to type into",
      },
      pressEnterKey: {
        type: "boolean",
        required: false,
        description: "Press Enter after typing",
      },
    },
    async execute(input, ctx) {
      const { sessionId, windowId, text, elementDescription, pressEnterKey } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { text };
      if (elementDescription) body.elementDescription = elementDescription;
      if (pressEnterKey) body.pressEnterKey = true;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/type`,
        body,
      );
    },
  });

  rl.registerAction("interaction.fill", {
    access: "write",
    description: "Fill a form using natural language description of the data",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      formData: {
        type: "string",
        required: true,
        description:
          "Form data in natural language (e.g. 'Name: John, Email: john@example.com')",
      },
    },
    async execute(input, ctx) {
      const { sessionId, windowId, formData } = input as Record<
        string,
        unknown
      >;
      const apiKey = getKey(ctx);

      // Start async automation
      const asyncResponse = (await apiRequest(
        apiKey,
        "POST",
        `/async/sessions/${sessionId}/windows/${windowId}/execute-automation`,
        { automationId: "auto", parameters: { customData: formData } },
      )) as Record<string, unknown>;

      const reqId = asyncResponse.requestId as string;
      if (!reqId) throw new Error("No requestId received from automation");

      // Poll until completed
      const result = await pollUntil(
        apiKey,
        `/requests/${reqId}/status`,
        "status",
        ["completed", "error"],
        5 * 60 * 1000,
      );
      return { sessionId, windowId, ...result };
    },
  });

  rl.registerAction("interaction.scroll", {
    access: "write",
    description: "Scroll within a browser window",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      scrollToElement: {
        type: "string",
        required: false,
        description:
          "Natural language description of element to scroll to (automatic mode)",
      },
      scrollToEdge: {
        type: "object",
        required: false,
        description: "{ xAxis?: 'left'|'right', yAxis?: 'top'|'bottom' }",
      },
      scrollBy: {
        type: "object",
        required: false,
        description: "{ xAxis?: '100px'|'50%', yAxis?: '200px'|'-100px' }",
      },
      scrollWithin: {
        type: "string",
        required: false,
        description: "Natural language description of scrollable area",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        scrollToElement,
        scrollToEdge,
        scrollBy,
        scrollWithin,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (scrollToElement) body.scrollToElement = scrollToElement;
      if (scrollToEdge) body.scrollToEdge = scrollToEdge;
      if (scrollBy) body.scrollBy = scrollBy;
      if (scrollWithin) body.scrollWithin = scrollWithin;
      return apiRequest(
        getKey(ctx),
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/scroll`,
        body,
      );
    },
  });

  // ── Agent ───────────────────────────────────────────

  rl.registerAction("agent.run", {
    access: "write",
    description: "Run an Airtop agent and optionally wait for completion",
    inputSchema: {
      agentId: { type: "string", required: true, description: "Agent ID" },
      parameters: {
        type: "object",
        required: false,
        description: "Agent input parameters",
      },
      awaitExecution: {
        type: "boolean",
        required: false,
        description: "Wait for agent to complete (default: true)",
      },
      timeoutSeconds: {
        type: "number",
        required: false,
        description: "Timeout in seconds (default: 600)",
      },
    },
    async execute(input, ctx) {
      const {
        agentId,
        parameters,
        awaitExecution = true,
        timeoutSeconds = 600,
      } = input as Record<string, unknown>;
      const apiKey = getKey(ctx);
      const HOOKS_BASE = "https://api.airtop.ai/api/hooks";

      // Get agent details for webhook ID
      const agentDetails = (await apiRequest(
        apiKey,
        "GET",
        `/agents/${agentId}`,
      )) as Record<string, unknown>;
      const data = agentDetails.data as Record<string, unknown>;
      const webhookId = data?.webhookId as string;
      if (!webhookId) throw new Error("No webhookId found for agent");

      // Invoke agent
      const invokeUrl = `${HOOKS_BASE}/agents/${agentId}/webhooks/${webhookId}`;
      const invocation = (await apiRequest(
        apiKey,
        "POST",
        invokeUrl,
        (parameters ?? {}) as Record<string, unknown>,
      )) as Record<string, unknown>;
      const invocationId = invocation.invocationId as string;
      if (!invocationId) throw new Error("No invocationId received");

      if (!awaitExecution) {
        return { invocationId };
      }

      // Poll for completion
      const start = Date.now();
      while (true) {
        const status = (await apiRequest(
          apiKey,
          "GET",
          `/agents/${agentId}/invocations/${invocationId}`,
        )) as Record<string, unknown>;
        const invData = status.data as Record<string, unknown> | undefined;
        const s = (invData?.status ?? status.status) as string;
        if (s === "completed" || s === "error") {
          if (invData?.error) throw new Error(`Agent error: ${invData.error}`);
          return { invocationId, status: s, output: invData?.output ?? {} };
        }
        if (Date.now() - start > (timeoutSeconds as number) * 1000) {
          throw new Error("Timeout waiting for agent completion");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description: "Get file details by ID",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { fileId } = input as { fileId: string };
      return apiRequest(getKey(ctx), "GET", `/files/${fileId}`);
    },
  });

  rl.registerAction("file.list", {
    access: "read",
    description: "List files, optionally filtered by session",
    inputSchema: {
      sessionIds: {
        type: "string",
        required: false,
        description: "Comma-separated session IDs to filter by",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { sessionIds, limit } = (input ?? {}) as {
        sessionIds?: string;
        limit?: number;
      };
      const qs: Record<string, unknown> = {};
      if (sessionIds) qs.sessionIds = sessionIds;
      if (limit) qs.limit = limit;
      return apiRequest(getKey(ctx), "GET", "/files", undefined, qs);
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file by ID",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { fileId } = input as { fileId: string };
      await apiRequest(getKey(ctx), "DELETE", `/files/${fileId}`);
      return { success: true };
    },
  });

  rl.registerAction("file.upload", {
    access: "write",
    description: "Upload a file from a URL to a session",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      fileName: {
        type: "string",
        required: true,
        description: "File name (must be unique per session)",
      },
      url: {
        type: "string",
        required: true,
        description: "URL to fetch the file from",
      },
      fileType: {
        type: "string",
        required: false,
        description:
          "File type: customer_upload, browser_download, screenshot, video",
      },
      triggerFileInput: {
        type: "boolean",
        required: false,
        description: "Trigger file input dialog (default: true)",
      },
      elementDescription: {
        type: "string",
        required: false,
        description: "Description of file input element",
      },
    },
    async execute(input, ctx) {
      const {
        sessionId,
        windowId,
        fileName,
        url,
        fileType = "customer_upload",
        triggerFileInput: triggerInput = true,
        elementDescription,
      } = input as Record<string, unknown>;
      const apiKey = getKey(ctx);

      // Fetch the file
      const fileRes = await fetch(url as string);
      if (!fileRes.ok)
        throw new Error(`Failed to fetch file from ${url}: ${fileRes.status}`);
      const fileBuffer = await fileRes.arrayBuffer();
      const base64 = Buffer.from(fileBuffer).toString("base64");

      // Create file
      const createResponse = (await apiRequest(apiKey, "POST", "/files", {
        fileName,
        fileType,
        content: base64,
      })) as Record<string, unknown>;
      const fileId = (createResponse.data as Record<string, unknown>)
        ?.id as string;

      // Push to session
      await apiRequest(apiKey, "POST", `/sessions/${sessionId}/files`, {
        fileId,
      });

      // Trigger file input if needed
      if (triggerInput) {
        const body: Record<string, unknown> = { fileId };
        if (elementDescription) body.elementDescription = elementDescription;
        await apiRequest(
          apiKey,
          "POST",
          `/sessions/${sessionId}/windows/${windowId}/trigger-file-input`,
          body,
        );
      }

      return { sessionId, windowId, fileId, success: true };
    },
  });

  rl.registerAction("file.load", {
    access: "write",
    description: "Load an existing file into a session and trigger file input",
    inputSchema: {
      sessionId: { type: "string", required: true, description: "Session ID" },
      windowId: { type: "string", required: true, description: "Window ID" },
      fileId: {
        type: "string",
        required: true,
        description: "File ID to load",
      },
      elementDescription: {
        type: "string",
        required: false,
        description: "Description of file input element",
      },
    },
    async execute(input, ctx) {
      const { sessionId, windowId, fileId, elementDescription } =
        input as Record<string, unknown>;
      const apiKey = getKey(ctx);

      // Push to session
      await apiRequest(apiKey, "POST", `/sessions/${sessionId}/files`, {
        fileId,
      });

      // Trigger file input
      const body: Record<string, unknown> = { fileId };
      if (elementDescription) body.elementDescription = elementDescription;
      await apiRequest(
        apiKey,
        "POST",
        `/sessions/${sessionId}/windows/${windowId}/trigger-file-input`,
        body,
      );

      return { sessionId, windowId, fileId, success: true };
    },
  });
}
