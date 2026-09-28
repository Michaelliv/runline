import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialOk,
  jsonAnswer,
  pathSegment,
} from "../../_shared/credentials.js";
import { bambooHrCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialOk(ctx, bambooHrCredential, "bambooHr", {
    target: "api",
    path,
    method,
    query,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
  // Some endpoints acknowledge with an empty or non-JSON body.
  const contentType = res.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? jsonAnswer(res)
    : { success: true };
}

export default function bambooHr(rl: RunlinePluginAPI) {
  rl.setName("bambooHr");
  rl.setVersion("0.1.0");
  rl.setCredential(bambooHrCredential);

  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description:
        "BambooHR subdomain (e.g. 'mycompany' for mycompany.bamboohr.com)",
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
    access: "write",
    description: "Create a new employee",
    inputSchema: {
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: true, description: "Last name" },
      department: {
        type: "string",
        required: false,
        description: "Department",
      },
      division: { type: "string", required: false, description: "Division" },
      employeeNumber: {
        type: "string",
        required: false,
        description: "Employee number",
      },
      gender: {
        type: "string",
        required: false,
        description: "Gender (Male/Female)",
      },
      hireDate: {
        type: "string",
        required: false,
        description: "Hire date (YYYY-MM-DD)",
      },
      location: { type: "string", required: false, description: "Location" },
      mobilePhone: {
        type: "string",
        required: false,
        description: "Mobile phone",
      },
      preferredName: {
        type: "string",
        required: false,
        description: "Preferred name",
      },
    },
    async execute(input, ctx) {
      const body = input as Record<string, unknown>;
      const res = await credentialOk(ctx, bambooHrCredential, "bambooHr", {
        target: "api",
        path: "employees",
        method: "POST",
        json: body,
      });
      const location = res.headers.get("location") ?? "";
      const employeeId = location.split("/").pop();
      return { id: employeeId };
    },
  });

  rl.registerAction("employee.get", {
    access: "read",
    description: "Get an employee by ID",
    inputSchema: {
      employeeId: {
        type: "string",
        required: true,
        description: "Employee ID",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated field names (default: all)",
      },
    },
    async execute(input, ctx) {
      const { employeeId, fields } = input as {
        employeeId: string;
        fields?: string;
      };
      let fieldList = fields ?? "all";
      if (fieldList === "all") {
        const dir = (await apiRequest(
          ctx,
          "GET",
          "employees/directory",
        )) as Record<string, unknown>;
        const dirFields = (dir.fields as Array<{ id: string }>) ?? [];
        fieldList = dirFields.map((f) => f.id).join(",");
      }
      return apiRequest(
        ctx,
        "GET",
        `employees/${pathSegment(employeeId)}`,
        undefined,
        {
          fields: fieldList,
        },
      );
    },
  });

  rl.registerAction("employee.list", {
    access: "read",
    description: "List all employees (directory)",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        "employees/directory",
      )) as Record<string, unknown>;
      const employees = (data.employees as unknown[]) ?? [];
      if (limit) return employees.slice(0, limit);
      return employees;
    },
  });

  rl.registerAction("employee.update", {
    access: "write",
    description: "Update an employee",
    inputSchema: {
      employeeId: {
        type: "string",
        required: true,
        description: "Employee ID",
      },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      department: {
        type: "string",
        required: false,
        description: "Department",
      },
      division: { type: "string", required: false, description: "Division" },
      gender: { type: "string", required: false, description: "Gender" },
      hireDate: {
        type: "string",
        required: false,
        description: "Hire date (YYYY-MM-DD)",
      },
      location: { type: "string", required: false, description: "Location" },
      mobilePhone: {
        type: "string",
        required: false,
        description: "Mobile phone",
      },
    },
    async execute(input, ctx) {
      const { employeeId, ...fields } = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "POST",
        `employees/${pathSegment(employeeId)}`,
        fields,
      );
      return { success: true };
    },
  });

  // ── Employee Document ───────────────────────────────

  rl.registerAction("employeeDocument.list", {
    access: "read",
    description: "List documents for an employee",
    inputSchema: {
      employeeId: {
        type: "string",
        required: true,
        description: "Employee ID",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { employeeId, limit } = input as {
        employeeId: string;
        limit?: number;
      };
      const data = (await apiRequest(
        ctx,
        "GET",
        `employees/${pathSegment(employeeId)}/files/view/`,
      )) as Record<string, unknown>;
      const categories =
        (data.categories as Array<Record<string, unknown>>) ?? [];

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
    access: "write",
    description: "Delete an employee document",
    inputSchema: {
      employeeId: {
        type: "string",
        required: true,
        description: "Employee ID",
      },
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { employeeId, fileId } = input as {
        employeeId: string;
        fileId: string;
      };
      await apiRequest(
        ctx,
        "DELETE",
        `employees/${pathSegment(employeeId)}/files/${pathSegment(fileId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("employeeDocument.update", {
    access: "write",
    description: "Update an employee document's metadata",
    inputSchema: {
      employeeId: {
        type: "string",
        required: true,
        description: "Employee ID",
      },
      fileId: { type: "string", required: true, description: "File ID" },
      shareWithEmployee: {
        type: "boolean",
        required: false,
        description: "Share file with employee",
      },
    },
    async execute(input, ctx) {
      const { employeeId, fileId, shareWithEmployee } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      body.shareWithEmployee = shareWithEmployee ? "yes" : "no";
      await apiRequest(
        ctx,
        "POST",
        `employees/${pathSegment(employeeId)}/files/${pathSegment(fileId)}`,
        body,
      );
      return { success: true };
    },
  });

  // ── Company File ────────────────────────────────────

  rl.registerAction("file.list", {
    access: "read",
    description: "List company files",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(ctx, "GET", "files/view")) as Record<
        string,
        unknown
      >;
      const categories =
        (data.categories as Array<Record<string, unknown>>) ?? [];

      const files: unknown[] = [];
      for (const cat of categories) {
        if (cat.files) files.push(...(cat.files as unknown[]));
      }
      if (limit) return files.slice(0, limit);
      return files;
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a company file",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { fileId } = input as { fileId: string };
      await apiRequest(ctx, "DELETE", `files/${pathSegment(fileId)}`);
      return { success: true };
    },
  });

  rl.registerAction("file.update", {
    access: "write",
    description: "Update a company file's metadata",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
      shareWithEmployee: {
        type: "boolean",
        required: false,
        description: "Share with employees",
      },
    },
    async execute(input, ctx) {
      const { fileId, shareWithEmployee } = input as Record<string, unknown>;
      await apiRequest(ctx, "POST", `files/${pathSegment(fileId)}`, {
        shareWithEmployee: shareWithEmployee ? "yes" : "no",
      });
      return { success: true };
    },
  });

  // ── Company Report ──────────────────────────────────

  rl.registerAction("companyReport.get", {
    access: "read",
    description: "Get a company report",
    inputSchema: {
      reportId: { type: "string", required: true, description: "Report ID" },
      format: {
        type: "string",
        required: false,
        description:
          "Format: JSON (default, parsed), CSV or XML (returned as text)",
      },
    },
    async execute(input, ctx) {
      const { reportId, format = "JSON" } = input as {
        reportId: string;
        format?: string;
      };
      if (!["JSON", "CSV", "XML"].includes(format))
        throw new Error("bambooHr: format must be JSON, CSV, or XML");
      const res = await credentialOk(ctx, bambooHrCredential, "bambooHr", {
        target: "api",
        path: `reports/${pathSegment(reportId)}/`,
        query: { format, fd: "true", onlyCurrent: "true" },
      });
      return format === "JSON" ? jsonAnswer(res) : res.text();
    },
  });
}
