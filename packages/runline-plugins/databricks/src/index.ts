import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  credentialOk,
  pathSegment,
  pathSegments,
} from "../../_shared/credentials.js";
import { databricksCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, string>,
): Promise<unknown> {
  return credentialJson(ctx, databricksCredential, "databricks", {
    target: "workspace",
    path,
    method,
    query: qs
      ? Object.fromEntries(Object.entries(qs).filter(([, v]) => v))
      : undefined,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function volumeParts(volumePath: string) {
  const parts = volumePath.split(".");
  if (parts.length !== 3)
    throw new Error("Volume path must be catalog.schema.volume");
  return parts as [string, string, string];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function databricks(rl: RunlinePluginAPI) {
  rl.setName("databricks");
  rl.setVersion("0.1.0");
  rl.setCredential(databricksCredential);
  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description:
        "Databricks workspace URL, e.g. https://adb-12345.azuredatabricks.net",
      env: "DATABRICKS_HOST",
    },
    accessToken: {
      type: "string",
      required: true,
      description: "Personal access token or OAuth2 token",
      env: "DATABRICKS_TOKEN",
    },
  });

  // ── Databricks SQL ──────────────────────────────────

  rl.registerAction("sql.executeQuery", {
    access: "write",
    description: "Execute a SQL query on a warehouse and return results",
    inputSchema: {
      warehouseId: {
        type: "string",
        required: true,
        description: "SQL warehouse ID",
      },
      query: { type: "string", required: true, description: "SQL statement" },
      parameters: {
        type: "object",
        required: false,
        description: "Array of {name, value, type?} query parameters",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const params = (p.parameters ?? []) as Array<{
        name: string;
        value: string;
        type?: string;
      }>;
      const body: Record<string, unknown> = {
        warehouse_id: p.warehouseId,
        statement: p.query,
        wait_timeout: "50s",
        on_wait_timeout: "CONTINUE",
      };
      if (params.length > 0)
        body.parameters = params.map(({ name, value, type }) =>
          type ? { name, value, type } : { name, value },
        );

      let result = (await api(
        ctx,
        "POST",
        "api/2.0/sql/statements",
        body,
      )) as Record<string, unknown>;
      const statementId = result.statement_id as string;
      let status = (result.status as Record<string, string>).state;
      let retries = 0;

      while (
        status !== "SUCCEEDED" &&
        status !== "FAILED" &&
        status !== "CANCELED" &&
        retries < 60
      ) {
        await sleep(5000);
        result = (await api(
          ctx,
          "GET",
          `api/2.0/sql/statements/${pathSegment(statementId)}`,
        )) as Record<string, unknown>;
        status = (result.status as Record<string, string>).state;
        retries++;
      }
      if (status === "FAILED" || status === "CANCELED")
        throw new Error(`Query ${status}: ${JSON.stringify(result.status)}`);
      if (retries >= 60) throw new Error("Query execution timeout");

      // Collect all chunks
      const allRows: unknown[][] = [];
      const manifest = result.manifest as Record<string, unknown> | undefined;
      const totalChunks = (manifest?.total_chunk_count ?? 0) as number;
      const resultData = result.result as Record<string, unknown> | undefined;
      if (resultData?.data_array) {
        allRows.push(...(resultData.data_array as unknown[][]));
      }
      let chunkIdx = allRows.length > 0 ? 1 : 0;
      while (chunkIdx < totalChunks) {
        const chunk = (await api(
          ctx,
          "GET",
          `api/2.0/sql/statements/${pathSegment(statementId)}/result/chunks/${pathSegment(chunkIdx)}`,
        )) as Record<string, unknown>;
        if (chunk.data_array)
          allRows.push(...(chunk.data_array as unknown[][]));
        chunkIdx++;
      }

      // Transform to objects
      const columns = ((manifest?.schema as Record<string, unknown>)?.columns ??
        []) as Array<{ name: string }>;
      return allRows.map((row) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, idx) => {
          obj[col.name] = (row as unknown[])[idx];
        });
        return obj;
      });
    },
  });

  // ── Files ───────────────────────────────────────────

  rl.registerAction("files.createDirectory", {
    access: "write",
    description: "Create a directory in a Unity Catalog volume",
    inputSchema: {
      volumePath: {
        type: "string",
        required: true,
        description: "catalog.schema.volume",
      },
      directoryPath: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const [cat, sch, vol] = volumeParts(p.volumePath as string);
      await api(
        ctx,
        "PUT",
        `api/2.0/fs/directories/Volumes/${pathSegment(cat)}/${pathSegment(sch)}/${pathSegment(vol)}/${pathSegments(p.directoryPath)}`,
      );
      return { success: true, directoryPath: p.directoryPath };
    },
  });

  rl.registerAction("files.deleteDirectory", {
    access: "write",
    description: "Delete a directory in a volume",
    inputSchema: {
      volumePath: {
        type: "string",
        required: true,
        description: "catalog.schema.volume",
      },
      directoryPath: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const [cat, sch, vol] = volumeParts(p.volumePath as string);
      await api(
        ctx,
        "DELETE",
        `api/2.0/fs/directories/Volumes/${pathSegment(cat)}/${pathSegment(sch)}/${pathSegment(vol)}/${pathSegments(p.directoryPath)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("files.deleteFile", {
    access: "write",
    description: "Delete a file in a volume",
    inputSchema: {
      volumePath: {
        type: "string",
        required: true,
        description: "catalog.schema.volume",
      },
      filePath: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const [cat, sch, vol] = volumeParts(p.volumePath as string);
      await api(
        ctx,
        "DELETE",
        `api/2.0/fs/files/Volumes/${pathSegment(cat)}/${pathSegment(sch)}/${pathSegment(vol)}/${pathSegments(p.filePath)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("files.getFileInfo", {
    access: "read",
    description: "Get file metadata (content-length, type, last-modified)",
    inputSchema: {
      volumePath: {
        type: "string",
        required: true,
        description: "catalog.schema.volume",
      },
      filePath: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const [cat, sch, vol] = volumeParts(p.volumePath as string);
      const res = await credentialOk(ctx, databricksCredential, "databricks", {
        target: "workspace",
        path: `api/2.0/fs/files/Volumes/${pathSegment(cat)}/${pathSegment(sch)}/${pathSegment(vol)}/${pathSegments(p.filePath)}`,
        method: "HEAD",
      });
      return {
        filePath: p.filePath,
        contentLength: res.headers.get("content-length"),
        contentType: res.headers.get("content-type"),
        lastModified: res.headers.get("last-modified"),
      };
    },
  });

  rl.registerAction("files.listDirectory", {
    access: "read",
    description: "List files in a volume directory",
    inputSchema: {
      volumePath: {
        type: "string",
        required: true,
        description: "catalog.schema.volume",
      },
      directoryPath: { type: "string", required: false },
      pageSize: { type: "number", required: false },
      pageToken: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const [cat, sch, vol] = volumeParts(p.volumePath as string);
      const dir = p.directoryPath ? `/${pathSegments(p.directoryPath)}` : "";
      const qs: Record<string, string> = {};
      if (p.pageSize) qs.page_size = String(p.pageSize);
      if (p.pageToken) qs.page_token = p.pageToken as string;
      return api(
        ctx,
        "GET",
        `api/2.0/fs/directories/Volumes/${pathSegment(cat)}/${pathSegment(sch)}/${pathSegment(vol)}${dir}`,
        undefined,
        qs,
      );
    },
  });

  // ── Genie ───────────────────────────────────────────

  rl.registerAction("genie.startConversation", {
    access: "write",
    description: "Start a new Genie conversation",
    inputSchema: {
      spaceId: { type: "string", required: true },
      initialMessage: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `api/2.0/genie/spaces/${pathSegment(p.spaceId)}/start-conversation`,
        { content: p.initialMessage },
      );
    },
  });

  rl.registerAction("genie.createMessage", {
    access: "write",
    description: "Send a message in an existing Genie conversation",
    inputSchema: {
      spaceId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `api/2.0/genie/spaces/${pathSegment(p.spaceId)}/conversations/${pathSegment(p.conversationId)}/messages`,
        { content: p.message },
      );
    },
  });

  rl.registerAction("genie.getMessage", {
    access: "read",
    description: "Get a specific message from a conversation",
    inputSchema: {
      spaceId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      messageId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "GET",
        `api/2.0/genie/spaces/${pathSegment(p.spaceId)}/conversations/${pathSegment(p.conversationId)}/messages/${pathSegment(p.messageId)}`,
      );
    },
  });

  rl.registerAction("genie.getQueryResults", {
    access: "read",
    description: "Get query results from a message attachment",
    inputSchema: {
      spaceId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      messageId: { type: "string", required: true },
      attachmentId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "GET",
        `api/2.0/genie/spaces/${pathSegment(p.spaceId)}/conversations/${pathSegment(p.conversationId)}/messages/${pathSegment(p.messageId)}/attachments/${pathSegment(p.attachmentId)}/query-result`,
      );
    },
  });

  rl.registerAction("genie.executeMessageQuery", {
    access: "write",
    description: "Execute a query from a message attachment",
    inputSchema: {
      spaceId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      messageId: { type: "string", required: true },
      attachmentId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `api/2.0/genie/spaces/${pathSegment(p.spaceId)}/conversations/${pathSegment(p.conversationId)}/messages/${pathSegment(p.messageId)}/attachments/${pathSegment(p.attachmentId)}/execute-query`,
      );
    },
  });

  rl.registerAction("genie.getSpace", {
    access: "read",
    description: "Get a Genie space",
    inputSchema: { spaceId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `api/2.0/genie/spaces/${pathSegment((input as Record<string, unknown>).spaceId)}`,
      );
    },
  });

  // ── Model Serving ───────────────────────────────────

  rl.registerAction("modelServing.queryEndpoint", {
    access: "write",
    description: "Query a model serving endpoint",
    inputSchema: {
      endpointName: { type: "string", required: true },
      requestBody: {
        type: "object",
        required: true,
        description:
          "JSON body matching the endpoint schema (chat, completions, embeddings, dataframe, etc.)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = p.requestBody as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `serving-endpoints/${pathSegment(p.endpointName)}/invocations`,
        body,
      );
    },
  });

  // ── Unity Catalog: Catalogs ─────────────────────────

  rl.registerAction("catalog.create", {
    access: "write",
    description: "Create a Unity Catalog catalog",
    inputSchema: {
      name: { type: "string", required: true },
      comment: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.comment) body.comment = p.comment;
      return api(ctx, "POST", "api/2.1/unity-catalog/catalogs", body);
    },
  });

  rl.registerAction("catalog.get", {
    access: "read",
    description: "Get a catalog",
    inputSchema: { name: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `api/2.1/unity-catalog/catalogs/${pathSegment((input as Record<string, unknown>).name)}`,
      );
    },
  });

  rl.registerAction("catalog.list", {
    access: "read",
    description: "List all catalogs",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "api/2.1/unity-catalog/catalogs");
    },
  });

  rl.registerAction("catalog.update", {
    access: "write",
    description: "Update a catalog's comment",
    inputSchema: {
      name: { type: "string", required: true },
      comment: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `api/2.1/unity-catalog/catalogs/${pathSegment(p.name)}`,
        { comment: p.comment },
      );
    },
  });

  rl.registerAction("catalog.delete", {
    access: "write",
    description: "Delete a catalog",
    inputSchema: { name: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `api/2.1/unity-catalog/catalogs/${pathSegment((input as Record<string, unknown>).name)}`,
      );
      return { success: true };
    },
  });

  // ── Unity Catalog: Tables ───────────────────────────

  rl.registerAction("table.create", {
    access: "write",
    description: "Create an external Delta table",
    inputSchema: {
      catalogName: { type: "string", required: true },
      schemaName: { type: "string", required: true },
      tableName: { type: "string", required: true },
      storageLocation: { type: "string", required: true },
      columns: {
        type: "object",
        required: false,
        description: "JSON array of column defs",
      },
      comment: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        catalog_name: p.catalogName,
        schema_name: p.schemaName,
        name: p.tableName,
        table_type: "EXTERNAL",
        data_source_format: "DELTA",
        storage_location: p.storageLocation,
      };
      if (p.columns) body.columns = p.columns;
      if (p.comment) body.comment = p.comment;
      return api(ctx, "POST", "api/2.1/unity-catalog/tables", body);
    },
  });

  rl.registerAction("table.get", {
    access: "read",
    description: "Get table info",
    inputSchema: {
      fullName: {
        type: "string",
        required: true,
        description: "catalog.schema.table",
      },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `api/2.1/unity-catalog/tables/${pathSegment((input as Record<string, unknown>).fullName)}`,
      );
    },
  });

  rl.registerAction("table.list", {
    access: "read",
    description: "List tables",
    inputSchema: {
      catalogName: { type: "string", required: false },
      schemaName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, string> = {};
      if (p.catalogName) qs.catalog_name = p.catalogName as string;
      if (p.schemaName) qs.schema_name = p.schemaName as string;
      return api(ctx, "GET", "api/2.1/unity-catalog/tables", undefined, qs);
    },
  });

  rl.registerAction("table.delete", {
    access: "write",
    description: "Delete a table",
    inputSchema: {
      fullName: {
        type: "string",
        required: true,
        description: "catalog.schema.table",
      },
    },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `api/2.1/unity-catalog/tables/${pathSegment((input as Record<string, unknown>).fullName)}`,
      );
      return { success: true };
    },
  });

  // ── Unity Catalog: Volumes ──────────────────────────

  rl.registerAction("volume.create", {
    access: "write",
    description: "Create a Unity Catalog volume",
    inputSchema: {
      catalogName: { type: "string", required: true },
      schemaName: { type: "string", required: true },
      volumeName: { type: "string", required: true },
      volumeType: {
        type: "string",
        required: true,
        description: "MANAGED or EXTERNAL",
      },
      storageLocation: {
        type: "string",
        required: false,
        description: "Required for EXTERNAL volumes",
      },
      comment: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      if (p.volumeType === "EXTERNAL" && !p.storageLocation)
        throw new Error("storageLocation required for EXTERNAL volumes");
      const body: Record<string, unknown> = {
        catalog_name: p.catalogName,
        schema_name: p.schemaName,
        name: p.volumeName,
        volume_type: p.volumeType,
      };
      if (p.storageLocation) body.storage_location = p.storageLocation;
      if (p.comment) body.comment = p.comment;
      return api(ctx, "POST", "api/2.1/unity-catalog/volumes", body);
    },
  });

  rl.registerAction("volume.get", {
    access: "read",
    description: "Get a volume",
    inputSchema: {
      catalogName: { type: "string", required: true },
      schemaName: { type: "string", required: true },
      volumeName: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "GET",
        `api/2.1/unity-catalog/volumes/${pathSegment(p.catalogName)}.${pathSegment(p.schemaName)}.${pathSegment(p.volumeName)}`,
      );
    },
  });

  rl.registerAction("volume.list", {
    access: "read",
    description: "List volumes",
    inputSchema: {
      catalogName: { type: "string", required: false },
      schemaName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, string> = {};
      if (p.catalogName) qs.catalog_name = p.catalogName as string;
      if (p.schemaName) qs.schema_name = p.schemaName as string;
      return api(ctx, "GET", "api/2.1/unity-catalog/volumes", undefined, qs);
    },
  });

  rl.registerAction("volume.delete", {
    access: "write",
    description: "Delete a volume",
    inputSchema: {
      catalogName: { type: "string", required: true },
      schemaName: { type: "string", required: true },
      volumeName: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await api(
        ctx,
        "DELETE",
        `api/2.1/unity-catalog/volumes/${pathSegment(p.catalogName)}.${pathSegment(p.schemaName)}.${pathSegment(p.volumeName)}`,
      );
      return { success: true };
    },
  });

  // ── Unity Catalog: Functions ────────────────────────

  rl.registerAction("function.create", {
    access: "write",
    description: "Create a Unity Catalog function",
    inputSchema: {
      catalogName: { type: "string", required: true },
      schemaName: { type: "string", required: true },
      functionName: { type: "string", required: true },
      inputParams: {
        type: "object",
        required: true,
        description:
          "Array of {name, type_name, type_text?} parameter definitions",
      },
      returnType: {
        type: "string",
        required: true,
        description: "e.g. STRING, INT",
      },
      routineBody: {
        type: "string",
        required: true,
        description: "SQL or EXTERNAL",
      },
      routineDefinition: {
        type: "string",
        required: true,
        description: "The function body",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const params = (
        Array.isArray(p.inputParams)
          ? p.inputParams
          : ((p.inputParams as Record<string, unknown>)?.parameters ?? [])
      ) as Array<Record<string, unknown>>;
      const normalizedParams = params.map((param) => ({
        ...param,
        type_text: param.type_text ?? param.type_name,
        type_json: param.type_json ?? JSON.stringify({ name: param.type_name }),
      }));
      return api(ctx, "POST", "api/2.1/unity-catalog/functions", {
        function_info: {
          name: p.functionName,
          catalog_name: p.catalogName,
          schema_name: p.schemaName,
          input_params: { parameters: normalizedParams },
          data_type: p.returnType,
          full_data_type: p.returnType,
          specific_name: p.functionName,
          parameter_style: "S",
          security_type: "DEFINER",
          sql_data_access: "CONTAINS_SQL",
          is_deterministic: false,
          is_null_call: true,
          routine_body: p.routineBody,
          routine_definition: p.routineDefinition,
        },
      });
    },
  });

  rl.registerAction("function.get", {
    access: "read",
    description: "Get a function",
    inputSchema: {
      fullName: {
        type: "string",
        required: true,
        description: "catalog.schema.function_name",
      },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `api/2.1/unity-catalog/functions/${pathSegment((input as Record<string, unknown>).fullName)}`,
      );
    },
  });

  rl.registerAction("function.list", {
    access: "read",
    description: "List functions",
    inputSchema: {
      catalogName: { type: "string", required: false },
      schemaName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, string> = {};
      if (p.catalogName) qs.catalog_name = p.catalogName as string;
      if (p.schemaName) qs.schema_name = p.schemaName as string;
      return api(ctx, "GET", "api/2.1/unity-catalog/functions", undefined, qs);
    },
  });

  rl.registerAction("function.delete", {
    access: "write",
    description: "Delete a function",
    inputSchema: {
      fullName: {
        type: "string",
        required: true,
        description: "catalog.schema.function_name",
      },
    },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `api/2.1/unity-catalog/functions/${pathSegment((input as Record<string, unknown>).fullName)}`,
      );
      return { success: true };
    },
  });

  // ── Vector Search ───────────────────────────────────

  rl.registerAction("vectorSearch.createIndex", {
    access: "write",
    description: "Create a vector search index",
    inputSchema: {
      indexName: { type: "string", required: true },
      endpointName: { type: "string", required: true },
      primaryKey: { type: "string", required: true },
      indexType: {
        type: "string",
        required: true,
        description: "DELTA_SYNC or DIRECT_ACCESS",
      },
      deltaSyncIndexSpec: {
        type: "object",
        required: false,
        description: "Spec for DELTA_SYNC type",
      },
      directAccessIndexSpec: {
        type: "object",
        required: false,
        description: "Spec for DIRECT_ACCESS type",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.indexName,
        endpoint_name: p.endpointName,
        primary_key: p.primaryKey,
        index_type: p.indexType,
      };
      if (p.indexType === "DELTA_SYNC" && p.deltaSyncIndexSpec)
        body.delta_sync_index_spec = p.deltaSyncIndexSpec;
      if (p.indexType === "DIRECT_ACCESS" && p.directAccessIndexSpec)
        body.direct_access_index_spec = p.directAccessIndexSpec;
      return api(ctx, "POST", "api/2.0/vector-search/indexes", body);
    },
  });

  rl.registerAction("vectorSearch.getIndex", {
    access: "read",
    description: "Get a vector search index",
    inputSchema: { indexName: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `api/2.0/vector-search/indexes/${pathSegment((input as Record<string, unknown>).indexName)}`,
      );
    },
  });

  rl.registerAction("vectorSearch.listIndexes", {
    access: "read",
    description: "List vector search indexes for an endpoint",
    inputSchema: { endpointName: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(ctx, "GET", "api/2.0/vector-search/indexes", undefined, {
        endpoint_name: (input as Record<string, unknown>)
          .endpointName as string,
      });
    },
  });

  rl.registerAction("vectorSearch.queryIndex", {
    access: "read",
    description: "Query a vector search index",
    inputSchema: {
      indexName: { type: "string", required: true },
      queryType: {
        type: "string",
        required: true,
        description: "text or vector",
      },
      queryText: {
        type: "string",
        required: false,
        description: "For text queries",
      },
      queryVector: {
        type: "object",
        required: false,
        description: "For vector queries — array of numbers",
      },
      numResults: { type: "number", required: false },
      columns: {
        type: "string",
        required: true,
        description: "Comma-separated column names to return",
      },
      searchMode: {
        type: "string",
        required: false,
        description: "HYBRID (default), ANN, or EXACT",
      },
      filterExpression: { type: "string", required: false },
      scoreThreshold: { type: "number", required: false },
      enableReranking: { type: "boolean", required: false },
      rerankerModel: { type: "string", required: false },
      columnsToRerank: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        num_results: p.numResults ?? 10,
        query_type: p.searchMode ?? "HYBRID",
      };
      if (p.queryType === "text") body.query_text = p.queryText;
      else body.query_vector = p.queryVector;
      body.columns = (p.columns as string)
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);
      if (p.filterExpression) body.filters_json = p.filterExpression;
      if (p.scoreThreshold) body.score_threshold = p.scoreThreshold;
      if (p.enableReranking) {
        body.reranker = {
          model: p.rerankerModel ?? "databricks_reranker",
          parameters: {
            columns_to_rerank: ((p.columnsToRerank as string) || "")
              .split(",")
              .map((c: string) => c.trim())
              .filter(Boolean),
          },
        };
      }
      return api(
        ctx,
        "POST",
        `api/2.0/vector-search/indexes/${pathSegment(p.indexName)}/query`,
        body,
      );
    },
  });
}
