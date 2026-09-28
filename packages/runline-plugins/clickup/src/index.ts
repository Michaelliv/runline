import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { clickupCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  // ClickUp's array parameters use the `key[]` convention.
  const query: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(qs ?? {}))
    query[Array.isArray(v) ? `${k}[]` : k] = v;
  return credentialJson(ctx, clickupCredential, "clickup", {
    target: "api",
    path: endpoint,
    method,
    query,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  endpoint: string,
  property: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 0;
  while (true) {
    const data = (await apiRequest(ctx, "GET", endpoint, undefined, {
      ...qs,
      page,
    })) as Record<string, unknown>;
    const items = (data[property] as unknown[]) ?? [];
    results.push(...items);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (items.length === 0 || (data.last_page as boolean)) break;
    page++;
  }
  return results;
}

export default function clickup(rl: RunlinePluginAPI) {
  rl.setName("clickup");
  rl.setVersion("0.1.0");
  rl.setCredential(clickupCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "ClickUp API token (personal or OAuth2 access token)",
      env: "CLICKUP_ACCESS_TOKEN",
    },
  });

  // ── Checklist ───────────────────────────────────────

  rl.registerAction("checklist.create", {
    access: "write",
    description: "Create a checklist on a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      name: { type: "string", required: true, description: "Checklist name" },
    },
    async execute(input, ctx) {
      const { taskId, name } = input as { taskId: string; name: string };
      const data = (await apiRequest(
        ctx,
        "POST",
        `task/${pathSegment(taskId)}/checklist`,
        { name },
      )) as Record<string, unknown>;
      return data.checklist;
    },
  });

  rl.registerAction("checklist.update", {
    access: "write",
    description: "Update a checklist",
    inputSchema: {
      checklistId: {
        type: "string",
        required: true,
        description: "Checklist ID",
      },
      name: { type: "string", required: false, description: "New name" },
      position: { type: "number", required: false, description: "Position" },
    },
    async execute(input, ctx) {
      const { checklistId, ...body } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `checklist/${pathSegment(checklistId)}`,
        body,
      )) as Record<string, unknown>;
      return data.checklist;
    },
  });

  rl.registerAction("checklist.delete", {
    access: "write",
    description: "Delete a checklist",
    inputSchema: {
      checklistId: {
        type: "string",
        required: true,
        description: "Checklist ID",
      },
    },
    async execute(input, ctx) {
      const { checklistId } = input as { checklistId: string };
      await apiRequest(ctx, "DELETE", `checklist/${pathSegment(checklistId)}`);
      return { success: true };
    },
  });

  // ── Checklist Item ──────────────────────────────────

  rl.registerAction("checklistItem.create", {
    access: "write",
    description: "Create a checklist item",
    inputSchema: {
      checklistId: {
        type: "string",
        required: true,
        description: "Checklist ID",
      },
      name: { type: "string", required: true, description: "Item name" },
      assignee: {
        type: "number",
        required: false,
        description: "Assignee user ID",
      },
    },
    async execute(input, ctx) {
      const { checklistId, name, assignee } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (assignee) body.assignee = assignee;
      const data = (await apiRequest(
        ctx,
        "POST",
        `checklist/${pathSegment(checklistId)}/checklist_item`,
        body,
      )) as Record<string, unknown>;
      return data.checklist;
    },
  });

  rl.registerAction("checklistItem.update", {
    access: "write",
    description: "Update a checklist item",
    inputSchema: {
      checklistId: {
        type: "string",
        required: true,
        description: "Checklist ID",
      },
      checklistItemId: {
        type: "string",
        required: true,
        description: "Checklist item ID",
      },
      name: { type: "string", required: false, description: "Name" },
      assignee: { type: "number", required: false, description: "Assignee" },
      resolved: { type: "boolean", required: false, description: "Resolved" },
      parent: {
        type: "string",
        required: false,
        description: "Parent checklist item ID",
      },
    },
    async execute(input, ctx) {
      const { checklistId, checklistItemId, ...body } = input as Record<
        string,
        unknown
      >;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `checklist/${pathSegment(checklistId)}/checklist_item/${pathSegment(checklistItemId)}`,
        body,
      )) as Record<string, unknown>;
      return data.checklist;
    },
  });

  rl.registerAction("checklistItem.delete", {
    access: "write",
    description: "Delete a checklist item",
    inputSchema: {
      checklistId: {
        type: "string",
        required: true,
        description: "Checklist ID",
      },
      checklistItemId: {
        type: "string",
        required: true,
        description: "Checklist item ID",
      },
    },
    async execute(input, ctx) {
      const { checklistId, checklistItemId } = input as {
        checklistId: string;
        checklistItemId: string;
      };
      await apiRequest(
        ctx,
        "DELETE",
        `checklist/${pathSegment(checklistId)}/checklist_item/${pathSegment(checklistItemId)}`,
      );
      return { success: true };
    },
  });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", {
    access: "write",
    description: "Create a comment on a task, view, or list",
    inputSchema: {
      commentOn: {
        type: "string",
        required: true,
        description: "Resource type: task, view, or list",
      },
      id: { type: "string", required: true, description: "Resource ID" },
      commentText: {
        type: "string",
        required: true,
        description: "Comment text",
      },
      assignee: {
        type: "number",
        required: false,
        description: "Assignee user ID",
      },
      notifyAll: {
        type: "boolean",
        required: false,
        description: "Notify all assignees",
      },
    },
    async execute(input, ctx) {
      const { commentOn, id, commentText, assignee, notifyAll } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { comment_text: commentText };
      if (assignee) body.assignee = assignee;
      if (notifyAll) body.notify_all = notifyAll;
      return apiRequest(
        ctx,
        "POST",
        `${pathSegment(commentOn)}/${pathSegment(id)}/comment`,
        body,
      );
    },
  });

  rl.registerAction("comment.list", {
    access: "read",
    description: "List comments on a task, view, or list",
    inputSchema: {
      commentsOn: {
        type: "string",
        required: true,
        description: "Resource type: task, view, or list",
      },
      id: { type: "string", required: true, description: "Resource ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { commentsOn, id, limit } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `${pathSegment(commentsOn)}/${pathSegment(id)}/comment`,
      )) as Record<string, unknown>;
      const comments = (data.comments as unknown[]) ?? [];
      if (limit) return comments.slice(0, limit as number);
      return comments;
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: {
      commentId: { type: "string", required: true, description: "Comment ID" },
      commentText: { type: "string", required: false, description: "New text" },
      assignee: { type: "number", required: false, description: "Assignee" },
      resolved: { type: "boolean", required: false, description: "Resolved" },
    },
    async execute(input, ctx) {
      const { commentId, commentText, assignee, resolved } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (commentText) body.comment_text = commentText;
      if (assignee) body.assignee = assignee;
      if (resolved !== undefined) body.resolved = resolved;
      await apiRequest(ctx, "PUT", `comment/${pathSegment(commentId)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: {
      commentId: { type: "string", required: true, description: "Comment ID" },
    },
    async execute(input, ctx) {
      const { commentId } = input as { commentId: string };
      await apiRequest(ctx, "DELETE", `comment/${pathSegment(commentId)}`);
      return { success: true };
    },
  });

  // ── Folder ──────────────────────────────────────────

  rl.registerAction("folder.create", {
    access: "write",
    description: "Create a folder in a space",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      name: { type: "string", required: true, description: "Folder name" },
    },
    async execute(input, ctx) {
      const { spaceId, name } = input as { spaceId: string; name: string };
      return apiRequest(ctx, "POST", `space/${pathSegment(spaceId)}/folder`, {
        name,
      });
    },
  });

  rl.registerAction("folder.get", {
    access: "read",
    description: "Get a folder",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `folder/${pathSegment((input as { folderId: string }).folderId)}`,
      );
    },
  });

  rl.registerAction("folder.list", {
    access: "read",
    description: "List folders in a space",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { spaceId, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (archived) qs.archived = archived;
      const data = (await apiRequest(
        ctx,
        "GET",
        `space/${pathSegment(spaceId)}/folder`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      const folders = (data.folders as unknown[]) ?? [];
      if (limit) return folders.slice(0, limit as number);
      return folders;
    },
  });

  rl.registerAction("folder.update", {
    access: "write",
    description: "Update a folder",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
      name: { type: "string", required: false, description: "New name" },
    },
    async execute(input, ctx) {
      const { folderId, ...body } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `folder/${pathSegment(folderId)}`, body);
    },
  });

  rl.registerAction("folder.delete", {
    access: "write",
    description: "Delete a folder",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `folder/${pathSegment((input as { folderId: string }).folderId)}`,
      );
      return { success: true };
    },
  });

  // ── Goal ────────────────────────────────────────────

  rl.registerAction("goal.create", {
    access: "write",
    description: "Create a goal",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      name: { type: "string", required: true, description: "Goal name" },
      dueDate: {
        type: "string",
        required: false,
        description: "Due date (ISO 8601)",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      color: { type: "string", required: false, description: "Color hex" },
      owners: {
        type: "array",
        required: false,
        description: "Array of owner user IDs",
      },
      multipleOwners: {
        type: "boolean",
        required: false,
        description: "Allow multiple owners",
      },
    },
    async execute(input, ctx) {
      const {
        teamId,
        name,
        dueDate,
        description,
        color,
        owners,
        multipleOwners,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      if (description) body.description = description;
      if (color) body.color = color;
      if (owners) body.owners = owners;
      if (multipleOwners !== undefined) body.multiple_owners = multipleOwners;
      const data = (await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/goal`,
        body,
      )) as Record<string, unknown>;
      return data.goal;
    },
  });

  rl.registerAction("goal.get", {
    access: "read",
    description: "Get a goal",
    inputSchema: {
      goalId: { type: "string", required: true, description: "Goal ID" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(
        ctx,
        "GET",
        `goal/${pathSegment((input as { goalId: string }).goalId)}`,
      )) as Record<string, unknown>;
      return data.goal;
    },
  });

  rl.registerAction("goal.list", {
    access: "read",
    description: "List goals for a team",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { teamId, limit } = input as { teamId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `team/${pathSegment(teamId)}/goal`,
      )) as Record<string, unknown>;
      const goals = (data.goals as unknown[]) ?? [];
      if (limit) return goals.slice(0, limit);
      return goals;
    },
  });

  rl.registerAction("goal.update", {
    access: "write",
    description: "Update a goal",
    inputSchema: {
      goalId: { type: "string", required: true, description: "Goal ID" },
      name: { type: "string", required: false, description: "Name" },
      dueDate: { type: "string", required: false, description: "Due date" },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      color: { type: "string", required: false, description: "Color" },
      addOwners: {
        type: "array",
        required: false,
        description: "User IDs to add as owners",
      },
      removeOwners: {
        type: "array",
        required: false,
        description: "User IDs to remove",
      },
    },
    async execute(input, ctx) {
      const { goalId, dueDate, addOwners, removeOwners, ...rest } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      if (addOwners) body.add_owners = addOwners;
      if (removeOwners) body.rem_owners = removeOwners;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `goal/${pathSegment(goalId)}`,
        body,
      )) as Record<string, unknown>;
      return data.goal;
    },
  });

  rl.registerAction("goal.delete", {
    access: "write",
    description: "Delete a goal",
    inputSchema: {
      goalId: { type: "string", required: true, description: "Goal ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `goal/${pathSegment((input as { goalId: string }).goalId)}`,
      );
      return { success: true };
    },
  });

  // ── Goal Key Result ─────────────────────────────────

  rl.registerAction("goalKeyResult.create", {
    access: "write",
    description: "Create a key result for a goal",
    inputSchema: {
      goalId: { type: "string", required: true, description: "Goal ID" },
      name: { type: "string", required: true, description: "Key result name" },
      type: {
        type: "string",
        required: true,
        description: "Type: number, currency, boolean, percentage, automatic",
      },
      unit: {
        type: "string",
        required: false,
        description: "Unit (for number/currency)",
      },
      stepsStart: {
        type: "number",
        required: false,
        description: "Start value",
      },
      stepsEnd: { type: "number", required: false, description: "End value" },
      taskIds: {
        type: "array",
        required: false,
        description: "Task IDs (for automatic type)",
      },
      listIds: {
        type: "array",
        required: false,
        description: "List IDs (for automatic type)",
      },
      owners: { type: "array", required: false, description: "Owner user IDs" },
    },
    async execute(input, ctx) {
      const { goalId, stepsStart, stepsEnd, taskIds, listIds, ...rest } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (stepsStart !== undefined) body.steps_start = stepsStart;
      if (stepsEnd !== undefined) body.steps_end = stepsEnd;
      if (taskIds) body.task_ids = taskIds;
      if (listIds) body.list_ids = listIds;
      const data = (await apiRequest(
        ctx,
        "POST",
        `goal/${pathSegment(goalId)}/key_result`,
        body,
      )) as Record<string, unknown>;
      return data.key_result;
    },
  });

  rl.registerAction("goalKeyResult.update", {
    access: "write",
    description: "Update a key result",
    inputSchema: {
      keyResultId: {
        type: "string",
        required: true,
        description: "Key result ID",
      },
      name: { type: "string", required: false, description: "Name" },
      note: { type: "string", required: false, description: "Note" },
      stepsCurrent: {
        type: "number",
        required: false,
        description: "Current steps",
      },
      stepsStart: {
        type: "number",
        required: false,
        description: "Start steps",
      },
      stepsEnd: { type: "number", required: false, description: "End steps" },
      unit: { type: "string", required: false, description: "Unit" },
    },
    async execute(input, ctx) {
      const { keyResultId, stepsCurrent, stepsStart, stepsEnd, ...rest } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (stepsCurrent !== undefined) body.steps_current = stepsCurrent;
      if (stepsStart !== undefined) body.steps_start = stepsStart;
      if (stepsEnd !== undefined) body.steps_end = stepsEnd;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `key_result/${pathSegment(keyResultId)}`,
        body,
      )) as Record<string, unknown>;
      return data.key_result;
    },
  });

  rl.registerAction("goalKeyResult.delete", {
    access: "write",
    description: "Delete a key result",
    inputSchema: {
      keyResultId: {
        type: "string",
        required: true,
        description: "Key result ID",
      },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `key_result/${pathSegment((input as { keyResultId: string }).keyResultId)}`,
      );
      return { success: true };
    },
  });

  // ── Guest ───────────────────────────────────────────

  rl.registerAction("guest.create", {
    access: "write",
    description: "Invite a guest to a workspace",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      email: { type: "string", required: true, description: "Guest email" },
      canEditTags: {
        type: "boolean",
        required: false,
        description: "Can edit tags",
      },
      canSeeTimeSpend: {
        type: "boolean",
        required: false,
        description: "Can see time spent",
      },
      canSeeTimeEstimated: {
        type: "boolean",
        required: false,
        description: "Can see time estimated",
      },
    },
    async execute(input, ctx) {
      const {
        teamId,
        email,
        canEditTags,
        canSeeTimeSpend,
        canSeeTimeEstimated,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (canEditTags !== undefined) body.can_edit_tags = canEditTags;
      if (canSeeTimeSpend !== undefined)
        body.can_see_time_spend = canSeeTimeSpend;
      if (canSeeTimeEstimated !== undefined)
        body.can_see_time_estimated = canSeeTimeEstimated;
      const data = (await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/guest`,
        body,
      )) as Record<string, unknown>;
      return data.team;
    },
  });

  rl.registerAction("guest.get", {
    access: "read",
    description: "Get a guest",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      guestId: { type: "string", required: true, description: "Guest ID" },
    },
    async execute(input, ctx) {
      const { teamId, guestId } = input as { teamId: string; guestId: string };
      const data = (await apiRequest(
        ctx,
        "GET",
        `team/${pathSegment(teamId)}/guest/${pathSegment(guestId)}`,
      )) as Record<string, unknown>;
      return data.team;
    },
  });

  rl.registerAction("guest.update", {
    access: "write",
    description: "Update a guest",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      guestId: { type: "string", required: true, description: "Guest ID" },
      username: { type: "string", required: false, description: "Username" },
      canEditTags: {
        type: "boolean",
        required: false,
        description: "Can edit tags",
      },
      canSeeTimeSpend: {
        type: "boolean",
        required: false,
        description: "Can see time spent",
      },
      canSeeTimeEstimated: {
        type: "boolean",
        required: false,
        description: "Can see time estimated",
      },
    },
    async execute(input, ctx) {
      const { teamId, guestId, ...body } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `team/${pathSegment(teamId)}/guest/${pathSegment(guestId)}`,
        body,
      )) as Record<string, unknown>;
      return data.team;
    },
  });

  rl.registerAction("guest.delete", {
    access: "write",
    description: "Remove a guest",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      guestId: { type: "string", required: true, description: "Guest ID" },
    },
    async execute(input, ctx) {
      const { teamId, guestId } = input as { teamId: string; guestId: string };
      await apiRequest(
        ctx,
        "DELETE",
        `team/${pathSegment(teamId)}/guest/${pathSegment(guestId)}`,
      );
      return { success: true };
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      name: { type: "string", required: true, description: "Task name" },
      content: {
        type: "string",
        required: false,
        description: "Task description",
      },
      markdownContent: {
        type: "string",
        required: false,
        description: "Markdown description",
      },
      assignees: {
        type: "array",
        required: false,
        description: "Assignee user IDs",
      },
      tags: { type: "array", required: false, description: "Tag names" },
      status: { type: "string", required: false, description: "Status" },
      priority: {
        type: "number",
        required: false,
        description: "Priority (1=urgent, 2=high, 3=normal, 4=low)",
      },
      dueDate: {
        type: "string",
        required: false,
        description: "Due date (ISO 8601)",
      },
      startDate: {
        type: "string",
        required: false,
        description: "Start date (ISO 8601)",
      },
      timeEstimate: {
        type: "number",
        required: false,
        description: "Time estimate in minutes",
      },
      notifyAll: {
        type: "boolean",
        required: false,
        description: "Notify all assignees",
      },
      parentId: {
        type: "string",
        required: false,
        description: "Parent task ID (for subtask)",
      },
      customFields: {
        type: "array",
        required: false,
        description: "Custom fields array [{id, value}]",
      },
    },
    async execute(input, ctx) {
      const {
        listId,
        dueDate,
        startDate,
        timeEstimate,
        markdownContent,
        parentId,
        customFields,
        ...rest
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      if (startDate) body.start_date = new Date(startDate as string).getTime();
      if (timeEstimate) body.time_estimate = (timeEstimate as number) * 60000;
      if (markdownContent) {
        body.markdown_content = markdownContent;
        delete body.content;
      }
      if (parentId) body.parent = parentId;
      if (customFields) body.custom_fields = customFields;
      return apiRequest(ctx, "POST", `list/${pathSegment(listId)}/task`, body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      includeSubtasks: {
        type: "boolean",
        required: false,
        description: "Include subtasks",
      },
    },
    async execute(input, ctx) {
      const { taskId, includeSubtasks } = input as {
        taskId: string;
        includeSubtasks?: boolean;
      };
      const qs: Record<string, unknown> = {};
      if (includeSubtasks) qs.include_subtasks = true;
      return apiRequest(
        ctx,
        "GET",
        `task/${pathSegment(taskId)}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      subtasks: {
        type: "boolean",
        required: false,
        description: "Include subtasks",
      },
      includeClosed: {
        type: "boolean",
        required: false,
        description: "Include closed",
      },
      orderBy: {
        type: "string",
        required: false,
        description: "Order by field",
      },
      statuses: {
        type: "array",
        required: false,
        description: "Filter by statuses",
      },
      assignees: {
        type: "array",
        required: false,
        description: "Filter by assignee IDs",
      },
      tags: { type: "array", required: false, description: "Filter by tags" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (omit for all)",
      },
    },
    async execute(input, ctx) {
      const { listId, limit, ...filters } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (filters.archived) qs.archived = filters.archived;
      if (filters.subtasks) qs.subtasks = filters.subtasks;
      if (filters.includeClosed) qs.include_closed = filters.includeClosed;
      if (filters.orderBy) qs.order_by = filters.orderBy;
      if (filters.statuses) qs.statuses = filters.statuses;
      if (filters.assignees) qs.assignees = filters.assignees;
      if (filters.tags) qs.tags = filters.tags;
      return paginateAll(
        ctx,
        `list/${pathSegment(listId)}/task`,
        "tasks",
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      name: { type: "string", required: false, description: "Name" },
      content: { type: "string", required: false, description: "Description" },
      status: { type: "string", required: false, description: "Status" },
      priority: { type: "number", required: false, description: "Priority" },
      dueDate: { type: "string", required: false, description: "Due date" },
      startDate: { type: "string", required: false, description: "Start date" },
      timeEstimate: {
        type: "number",
        required: false,
        description: "Time estimate (minutes)",
      },
      addAssignees: {
        type: "array",
        required: false,
        description: "User IDs to add",
      },
      removeAssignees: {
        type: "array",
        required: false,
        description: "User IDs to remove",
      },
    },
    async execute(input, ctx) {
      const {
        taskId,
        dueDate,
        startDate,
        timeEstimate,
        addAssignees,
        removeAssignees,
        ...rest
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      if (startDate) body.start_date = new Date(startDate as string).getTime();
      if (timeEstimate) body.time_estimate = (timeEstimate as number) * 60000;
      body.assignees = { add: addAssignees ?? [], rem: removeAssignees ?? [] };
      return apiRequest(ctx, "PUT", `task/${pathSegment(taskId)}`, body);
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `task/${pathSegment((input as { taskId: string }).taskId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("task.getMembers", {
    access: "read",
    description: "Get task members",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { taskId, limit } = input as { taskId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `task/${pathSegment(taskId)}/member`,
      )) as Record<string, unknown>;
      const members = (data.members as unknown[]) ?? [];
      if (limit) return members.slice(0, limit);
      return members;
    },
  });

  rl.registerAction("task.setCustomField", {
    access: "write",
    description: "Set a custom field value on a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      fieldId: {
        type: "string",
        required: true,
        description: "Custom field ID",
      },
      value: {
        type: "string",
        required: true,
        description: "Value (string, number, or JSON)",
      },
    },
    async execute(input, ctx) {
      const { taskId, fieldId, value } = input as {
        taskId: string;
        fieldId: string;
        value: unknown;
      };
      return apiRequest(
        ctx,
        "POST",
        `task/${pathSegment(taskId)}/field/${pathSegment(fieldId)}`,
        { value },
      );
    },
  });

  // ── Task Tag ────────────────────────────────────────

  rl.registerAction("taskTag.add", {
    access: "write",
    description: "Add a tag to a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { taskId, tagName } = input as { taskId: string; tagName: string };
      await apiRequest(
        ctx,
        "POST",
        `task/${pathSegment(taskId)}/tag/${pathSegment(tagName)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("taskTag.remove", {
    access: "write",
    description: "Remove a tag from a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { taskId, tagName } = input as { taskId: string; tagName: string };
      await apiRequest(
        ctx,
        "DELETE",
        `task/${pathSegment(taskId)}/tag/${pathSegment(tagName)}`,
      );
      return { success: true };
    },
  });

  // ── Task List ───────────────────────────────────────

  rl.registerAction("taskList.add", {
    access: "write",
    description: "Add a task to a list",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { taskId, listId } = input as { taskId: string; listId: string };
      await apiRequest(
        ctx,
        "POST",
        `list/${pathSegment(listId)}/task/${pathSegment(taskId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("taskList.remove", {
    access: "write",
    description: "Remove a task from a list",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { taskId, listId } = input as { taskId: string; listId: string };
      await apiRequest(
        ctx,
        "DELETE",
        `list/${pathSegment(listId)}/task/${pathSegment(taskId)}`,
      );
      return { success: true };
    },
  });

  // ── Task Dependency ─────────────────────────────────

  rl.registerAction("taskDependency.create", {
    access: "write",
    description: "Add a dependency to a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      dependsOnTaskId: {
        type: "string",
        required: true,
        description: "Task this depends on",
      },
    },
    async execute(input, ctx) {
      const { taskId, dependsOnTaskId } = input as {
        taskId: string;
        dependsOnTaskId: string;
      };
      await apiRequest(ctx, "POST", `task/${pathSegment(taskId)}/dependency`, {
        depends_on: dependsOnTaskId,
      });
      return { success: true };
    },
  });

  rl.registerAction("taskDependency.delete", {
    access: "write",
    description: "Remove a dependency from a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task ID" },
      dependsOnTaskId: {
        type: "string",
        required: true,
        description: "Dependent task ID",
      },
    },
    async execute(input, ctx) {
      const { taskId, dependsOnTaskId } = input as {
        taskId: string;
        dependsOnTaskId: string;
      };
      await apiRequest(
        ctx,
        "DELETE",
        `task/${pathSegment(taskId)}/dependency`,
        undefined,
        { depends_on: dependsOnTaskId },
      );
      return { success: true };
    },
  });

  // ── Space Tag ───────────────────────────────────────

  rl.registerAction("spaceTag.create", {
    access: "write",
    description: "Create a tag in a space",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      name: { type: "string", required: true, description: "Tag name" },
      foregroundColor: {
        type: "string",
        required: true,
        description: "Text color hex",
      },
      backgroundColor: {
        type: "string",
        required: true,
        description: "Background color hex",
      },
    },
    async execute(input, ctx) {
      const { spaceId, name, foregroundColor, backgroundColor } =
        input as Record<string, string>;
      await apiRequest(ctx, "POST", `space/${pathSegment(spaceId)}/tag`, {
        tag: { name, tag_fg: foregroundColor, tag_bg: backgroundColor },
      });
      return { success: true };
    },
  });

  rl.registerAction("spaceTag.list", {
    access: "read",
    description: "List tags in a space",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { spaceId, limit } = input as { spaceId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `space/${pathSegment(spaceId)}/tag`,
      )) as Record<string, unknown>;
      const tags = (data.tags as unknown[]) ?? [];
      if (limit) return tags.slice(0, limit);
      return tags;
    },
  });

  rl.registerAction("spaceTag.update", {
    access: "write",
    description: "Update a space tag",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      tagName: {
        type: "string",
        required: true,
        description: "Current tag name",
      },
      newName: { type: "string", required: true, description: "New tag name" },
      foregroundColor: {
        type: "string",
        required: true,
        description: "Text color hex",
      },
      backgroundColor: {
        type: "string",
        required: true,
        description: "Background color hex",
      },
    },
    async execute(input, ctx) {
      const { spaceId, tagName, newName, foregroundColor, backgroundColor } =
        input as Record<string, string>;
      await apiRequest(
        ctx,
        "PUT",
        `space/${pathSegment(spaceId)}/tag/${pathSegment(tagName)}`,
        {
          tag: {
            name: newName,
            tag_fg: foregroundColor,
            tag_bg: backgroundColor,
          },
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("spaceTag.delete", {
    access: "write",
    description: "Delete a space tag",
    inputSchema: {
      spaceId: { type: "string", required: true, description: "Space ID" },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { spaceId, tagName } = input as {
        spaceId: string;
        tagName: string;
      };
      await apiRequest(
        ctx,
        "DELETE",
        `space/${pathSegment(spaceId)}/tag/${pathSegment(tagName)}`,
      );
      return { success: true };
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.create", {
    access: "write",
    description: "Create a list (in a folder or folderless in a space)",
    inputSchema: {
      name: { type: "string", required: true, description: "List name" },
      spaceId: {
        type: "string",
        required: false,
        description: "Space ID (for folderless list)",
      },
      folderId: {
        type: "string",
        required: false,
        description: "Folder ID (for list in folder)",
      },
      content: { type: "string", required: false, description: "Description" },
      dueDate: { type: "string", required: false, description: "Due date" },
      priority: { type: "number", required: false, description: "Priority" },
      assignee: {
        type: "number",
        required: false,
        description: "Assignee user ID",
      },
      status: { type: "string", required: false, description: "Status" },
    },
    async execute(input, ctx) {
      const { name, spaceId, folderId, dueDate, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name, ...rest };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      const endpoint = folderId
        ? `folder/${pathSegment(folderId)}/list`
        : `space/${pathSegment(spaceId)}/list`;
      return apiRequest(ctx, "POST", endpoint, body);
    },
  });

  rl.registerAction("list.get", {
    access: "read",
    description: "Get a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `list/${pathSegment((input as { listId: string }).listId)}`,
      );
    },
  });

  rl.registerAction("list.list", {
    access: "read",
    description: "List lists in a folder or space",
    inputSchema: {
      spaceId: {
        type: "string",
        required: false,
        description: "Space ID (for folderless)",
      },
      folderId: { type: "string", required: false, description: "Folder ID" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { spaceId, folderId, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (archived) qs.archived = archived;
      const endpoint = folderId
        ? `folder/${pathSegment(folderId)}/list`
        : `space/${pathSegment(spaceId)}/list`;
      const data = (await apiRequest(
        ctx,
        "GET",
        endpoint,
        undefined,
        qs,
      )) as Record<string, unknown>;
      const lists = (data.lists as unknown[]) ?? [];
      if (limit) return lists.slice(0, limit as number);
      return lists;
    },
  });

  rl.registerAction("list.update", {
    access: "write",
    description: "Update a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      name: { type: "string", required: false, description: "Name" },
      content: { type: "string", required: false, description: "Description" },
      dueDate: { type: "string", required: false, description: "Due date" },
      priority: { type: "number", required: false, description: "Priority" },
      assignee: { type: "number", required: false, description: "Assignee" },
      unsetStatus: {
        type: "boolean",
        required: false,
        description: "Unset status",
      },
    },
    async execute(input, ctx) {
      const { listId, dueDate, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (dueDate) body.due_date = new Date(dueDate as string).getTime();
      return apiRequest(ctx, "PUT", `list/${pathSegment(listId)}`, body);
    },
  });

  rl.registerAction("list.delete", {
    access: "write",
    description: "Delete a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `list/${pathSegment((input as { listId: string }).listId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("list.getMembers", {
    access: "read",
    description: "Get list members",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { listId, limit } = input as { listId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `list/${pathSegment(listId)}/member`,
      )) as Record<string, unknown>;
      const members = (data.members as unknown[]) ?? [];
      if (limit) return members.slice(0, limit);
      return members;
    },
  });

  rl.registerAction("list.getCustomFields", {
    access: "read",
    description: "Get custom fields for a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(
        ctx,
        "GET",
        `list/${pathSegment((input as { listId: string }).listId)}/field`,
      )) as Record<string, unknown>;
      return data.fields;
    },
  });

  // ── Time Entry ──────────────────────────────────────

  rl.registerAction("timeEntry.create", {
    access: "write",
    description: "Create a time entry",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      taskId: { type: "string", required: true, description: "Task ID" },
      start: {
        type: "string",
        required: true,
        description: "Start time (ISO 8601)",
      },
      duration: {
        type: "number",
        required: true,
        description: "Duration in minutes",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      billable: { type: "boolean", required: false, description: "Billable" },
    },
    async execute(input, ctx) {
      const { teamId, taskId, start, duration, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        tid: taskId,
        start: new Date(start as string).getTime(),
        duration: (duration as number) * 60000,
        ...rest,
      };
      const data = (await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/time_entries`,
        body,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("timeEntry.get", {
    access: "read",
    description: "Get a time entry (or current running timer)",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      timeEntryId: {
        type: "string",
        required: false,
        description: "Time entry ID (omit for current)",
      },
    },
    async execute(input, ctx) {
      const { teamId, timeEntryId } = input as {
        teamId: string;
        timeEntryId?: string;
      };
      const endpoint = timeEntryId
        ? `team/${pathSegment(teamId)}/time_entries/${pathSegment(timeEntryId)}`
        : `team/${pathSegment(teamId)}/time_entries/current`;
      const data = (await apiRequest(ctx, "GET", endpoint)) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });

  rl.registerAction("timeEntry.list", {
    access: "read",
    description: "List time entries for a team",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      startDate: {
        type: "string",
        required: false,
        description: "Start date filter",
      },
      endDate: {
        type: "string",
        required: false,
        description: "End date filter",
      },
      assignee: {
        type: "array",
        required: false,
        description: "Assignee user IDs",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { teamId, startDate, endDate, assignee, limit } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (startDate) qs.start_date = new Date(startDate as string).getTime();
      if (endDate) qs.end_date = new Date(endDate as string).getTime();
      if (assignee) qs.assignee = assignee;
      const data = (await apiRequest(
        ctx,
        "GET",
        `team/${pathSegment(teamId)}/time_entries`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      const entries = (data.data as unknown[]) ?? [];
      if (limit) return entries.slice(0, limit as number);
      return entries;
    },
  });

  rl.registerAction("timeEntry.update", {
    access: "write",
    description: "Update a time entry",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      timeEntryId: {
        type: "string",
        required: true,
        description: "Time entry ID",
      },
      start: { type: "string", required: false, description: "Start time" },
      duration: {
        type: "number",
        required: false,
        description: "Duration in minutes",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      billable: { type: "boolean", required: false, description: "Billable" },
    },
    async execute(input, ctx) {
      const { teamId, timeEntryId, start, duration, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { ...rest };
      if (start) body.start = new Date(start as string).getTime();
      if (duration) body.duration = (duration as number) * 60000;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `team/${pathSegment(teamId)}/time_entries/${pathSegment(timeEntryId)}`,
        body,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("timeEntry.start", {
    access: "write",
    description: "Start a timer on a task",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      taskId: { type: "string", required: true, description: "Task ID" },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      billable: { type: "boolean", required: false, description: "Billable" },
    },
    async execute(input, ctx) {
      const { teamId, taskId, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { tid: taskId, ...rest };
      const data = (await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/time_entries/start`,
        body,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("timeEntry.stop", {
    access: "write",
    description: "Stop the running timer",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
    },
    async execute(input, ctx) {
      const { teamId } = input as { teamId: string };
      const data = (await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/time_entries/stop`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("timeEntry.delete", {
    access: "write",
    description: "Delete a time entry",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      timeEntryId: {
        type: "string",
        required: true,
        description: "Time entry ID",
      },
    },
    async execute(input, ctx) {
      const { teamId, timeEntryId } = input as {
        teamId: string;
        timeEntryId: string;
      };
      const data = (await apiRequest(
        ctx,
        "DELETE",
        `team/${pathSegment(teamId)}/time_entries/${pathSegment(timeEntryId)}`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  // ── Time Entry Tag ──────────────────────────────────

  rl.registerAction("timeEntryTag.add", {
    access: "write",
    description: "Add tags to time entries",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      timeEntryIds: {
        type: "array",
        required: true,
        description: "Array of time entry IDs",
      },
      tags: {
        type: "array",
        required: true,
        description: "Array of {name, tag_bg, tag_fg} objects",
      },
    },
    async execute(input, ctx) {
      const { teamId, timeEntryIds, tags } = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "POST",
        `team/${pathSegment(teamId)}/time_entries/tags`,
        {
          time_entry_ids: timeEntryIds,
          tags,
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("timeEntryTag.list", {
    access: "read",
    description: "List time entry tags for a team",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { teamId, limit } = input as { teamId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `team/${pathSegment(teamId)}/time_entries/tags`,
      )) as Record<string, unknown>;
      const tags = (data.data as unknown[]) ?? [];
      if (limit) return tags.slice(0, limit);
      return tags;
    },
  });

  rl.registerAction("timeEntryTag.remove", {
    access: "write",
    description: "Remove tags from time entries",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      timeEntryIds: {
        type: "array",
        required: true,
        description: "Array of time entry IDs",
      },
      tagNames: {
        type: "array",
        required: true,
        description: "Array of tag names to remove",
      },
    },
    async execute(input, ctx) {
      const { teamId, timeEntryIds, tagNames } = input as Record<
        string,
        unknown
      >;
      await apiRequest(
        ctx,
        "DELETE",
        `team/${pathSegment(teamId)}/time_entries/tags`,
        {
          time_entry_ids: timeEntryIds,
          tags: tagNames,
        },
      );
      return { success: true };
    },
  });
}
