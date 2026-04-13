import type { RunlinePluginAPI } from "runline";

function buildBaseUrl(subdomain: string): string {
  return `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1`;
}

async function apiRequest(
  subdomain: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${buildBaseUrl(subdomain)}/${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${apiKey}:x`)}`,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BambooHR API error ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return { success: true };
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    subdomain: ctx.connection.config.subdomain as string,
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function bambooHr(rl: RunlinePluginAPI) {
  rl.setName("bambooHr");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description: "BambooHR subdomain (e.g. 'mycompany' for mycompany.bamboohr.com)",
      env: "BAMBOO_HR_SUBDOMAIN",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "BambooHR API key",
      env: "BAMBOO_HR_API_KEY",
    },
  });

  // ── Employee ────────────────────────────────────────

  rl.registerAction("employee.create", {
    description: "Create a new employee",
    inputSchema: {
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: true, description: "Last name" },
      department: { type: "string", required: false, description: "Department" },
      division: { type: "string", required: false, description: "Division" },
      employeeNumber: { type: "string", required: false, description: "Employee number" },
      gender: { type: "string", required: false, description: "Gender (Male/Female)" },
      hireDate: { type: "string", required: false, description: "Hire date (YYYY-MM-DD)" },
      location: { type: "string", required: false, description: "Location" },
      mobilePhone: { type: "string", required: false, description: "Mobile phone" },
      preferredName: { type: "string", required: false, description: "Preferred name" },
    },
    async execute(input, ctx) {
      const { subdomain, apiKey } = getConn(ctx);
      const body = input as Record<string, unknown>;
      const res = await fetch(`${buildBaseUrl(subdomain)}/employees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${btoa(`${apiKey}:x`)}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`BambooHR error ${res.status}: ${await res.text()}`);
      const location = res.headers.get("location") ?? "";
      const employeeId = location.split("/").pop();
      return { id: employeeId };
    },
  });

  rl.registerAction("employee.get", {
    description: "Get an employee by ID",
    inputSchema: {
      employeeId: { type: "string", required: true, description: "Employee ID" },
      fields: { type: "string", required: false, description: "Comma-separated field names (default: all)" },
    },
    async execute(input, ctx) {
      const { employeeId, fields } = input as { employeeId: string; fields?: string };
      const { subdomain, apiKey } = getConn(ctx);
      let fieldList = fields ?? "all";
      if (fieldList === "all") {
        const dir = (await apiRequest(subdomain, apiKey, "GET", "employees/directory")) as Record<string, unknown>;
        const dirFields = (dir.fields as Array<{ id: string }>) ?? [];
        fieldList = dirFields.map((f) => f.id).join(",");
      }
      return apiRequest(subdomain, apiKey, "GET", `employees/${employeeId}?fields=${fieldList}`);
    },
  });

  rl.registerAction("employee.list", {
    description: "List all employees (directory)",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const { subdomain, apiKey } = getConn(ctx);
      const data = (await apiRequest(subdomain, apiKey, "GET", "employees/directory")) as Record<string, unknown>;
      const employees = (data.employees as unknown[]) ?? [];
      if (limit) return employees.slice(0, limit);
      return employees;
    },
  });

  rl.registerAction("employee.update", {
    description: "Update an employee",
    inputSchema: {
      employeeId: { type: "string", required: true, description: "Employee ID" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      department: { type: "string", required: false, description: "Department" },
      division: { type: "string", required: false, description: "Division" },
      gender: { type: "string", required: false, description: "Gender" },
      hireDate: { type: "string", required: false, description: "Hire date (YYYY-MM-DD)" },
      location: { type: "string", required: false, description: "Location" },
      mobilePhone: { type: "string", required: false, description: "Mobile phone" },
    },
    async execute(input, ctx) {
      const { employeeId, ...fields } = input as Record<string, unknown>;
      const { subdomain, apiKey } = getConn(ctx);
      await apiRequest(subdomain, apiKey, "POST", `employees/${employeeId}`, fields);
      return { success: true };
    },
  });

  // ── Employee Document ───────────────────────────────

  rl.registerAction("employeeDocument.list", {
    description: "List documents for an employee",
    inputSchema: {
      employeeId: { type: "string", required: true, description: "Employee ID" },
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { employeeId, limit } = input as { employeeId: string; limit?: number };
      const { subdomain, apiKey } = getConn(ctx);
      const data = (await apiRequest(subdomain, apiKey, "GET", `employees/${employeeId}/files/view/`)) as Record<string, unknown>;
      const categories = (data.categories as Array<Record<string, unknown>>) ?? [];

      // Flatten files from all categories
      const files: unknown[] = [];
      for (const cat of categories) {
        if (cat.files) files.push(...(cat.files as unknown[]));
      }
      if (limit) return files.slice(0, limit);
      return files;
    },
  });

  rl.registerAction("employeeDocument.delete", {
    description: "Delete an employee document",
    inputSchema: {
      employeeId: { type: "string", required: true, description: "Employee ID" },
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { employeeId, fileId } = input as { employeeId: string; fileId: string };
      const { subdomain, apiKey } = getConn(ctx);
      await apiRequest(subdomain, apiKey, "DELETE", `employees/${employeeId}/files/${fileId}`);
      return { success: true };
    },
  });

  rl.registerAction("employeeDocument.update", {
    description: "Update an employee document's metadata",
    inputSchema: {
      employeeId: { type: "string", required: true, description: "Employee ID" },
      fileId: { type: "string", required: true, description: "File ID" },
      shareWithEmployee: { type: "boolean", required: false, description: "Share file with employee" },
    },
    async execute(input, ctx) {
      const { employeeId, fileId, shareWithEmployee } = input as Record<string, unknown>;
      const { subdomain, apiKey } = getConn(ctx);
      const body: Record<string, unknown> = {};
      body.shareWithEmployee = shareWithEmployee ? "yes" : "no";
      await apiRequest(subdomain, apiKey, "POST", `employees/${employeeId}/files/${fileId}`, body);
      return { success: true };
    },
  });

  // ── Company File ────────────────────────────────────

  rl.registerAction("file.list", {
    description: "List company files",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const { subdomain, apiKey } = getConn(ctx);
      const data = (await apiRequest(subdomain, apiKey, "GET", "files/view")) as Record<string, unknown>;
      const categories = (data.categories as Array<Record<string, unknown>>) ?? [];

      const files: unknown[] = [];
      for (const cat of categories) {
        if (cat.files) files.push(...(cat.files as unknown[]));
      }
      if (limit) return files.slice(0, limit);
      return files;
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a company file",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { fileId } = input as { fileId: string };
      const { subdomain, apiKey } = getConn(ctx);
      await apiRequest(subdomain, apiKey, "DELETE", `files/${fileId}`);
      return { success: true };
    },
  });

  rl.registerAction("file.update", {
    description: "Update a company file's metadata",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
      shareWithEmployee: { type: "boolean", required: false, description: "Share with employees" },
    },
    async execute(input, ctx) {
      const { fileId, shareWithEmployee } = input as Record<string, unknown>;
      const { subdomain, apiKey } = getConn(ctx);
      await apiRequest(subdomain, apiKey, "POST", `files/${fileId}`, {
        shareWithEmployee: shareWithEmployee ? "yes" : "no",
      });
      return { success: true };
    },
  });

  // ── Company Report ──────────────────────────────────

  rl.registerAction("companyReport.get", {
    description: "Get a company report",
    inputSchema: {
      reportId: { type: "string", required: true, description: "Report ID" },
      format: { type: "string", required: false, description: "Format: JSON, CSV, XLS, XML, PDF (default: JSON)" },
    },
    async execute(input, ctx) {
      const { reportId, format = "JSON" } = input as { reportId: string; format?: string };
      const { subdomain, apiKey } = getConn(ctx);
      return apiRequest(
        subdomain,
        apiKey,
        "GET",
        `reports/${reportId}/?format=${format}&fd=true&onlyCurrent=true`,
      );
    },
  });
}
