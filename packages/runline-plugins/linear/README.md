# Linear plugin notes

## Link projects to initiatives

Use `linear.initiative.addProject`, not `linear.project.update`, to associate a project with an initiative. Linear models this as a separate `initiativeToProject` relationship, so `project.update({ initiativeId })` is not a valid workflow.

```ts
const link = await linear.initiative.addProject({
  initiativeId: "initiative-id-or-slug",
  projectId: "project-id-or-slug",
});

await linear.initiative.get({ id: "initiative-id-or-slug" });
```

`initiative.addProject` returns the link id plus the linked project and initiative project list so the relationship is easy to verify. To unlink, pass that link id to `initiative.removeProject`:

```ts
await linear.initiative.removeProject({ id: link.initiativeToProject.id });
await linear.initiative.get({ id: "initiative-id-or-slug" });
```

## Create custom views

`linear.view.create` accepts Linear filter payloads directly. The `filterData` field description includes compact examples for label, project, assignee, state, priority, due date, and combined agenda-style issue views.

```ts
await linear.view.create({
  name: "High-priority agenda",
  shared: false,
  teamId: "team-id",
  filterData: {
    and: [
      { assignee: { id: { eq: "user-id" } } },
      { state: { type: { nin: ["completed", "canceled"] } } },
      { or: [{ priority: { lte: 2 } }, { dueDate: { lte: "2026-06-16" } }] },
    ],
  },
});
```

Common issue filter shapes:

```ts
{ labels: { id: { in: ["label-id"] } } }
{ project: { id: { eq: "project-id" } } }
{ assignee: { id: { eq: "user-id" } } }
{ state: { id: { eq: "state-id" } } }
{ priority: { eq: 1 } }
{ dueDate: { gte: "2026-06-09", lte: "2026-06-16" } }
{
  and: [
    { assignee: { id: { eq: "user-id" } } },
    { state: { type: { nin: ["completed", "canceled"] } } },
    { or: [{ priority: { lte: 2 } }, { dueDate: { lte: "2026-06-16" } }] },
  ],
}
```

`shared: false` creates a personal view. `shared: true` shares it with the workspace or scoped container. `teamId`, `projectId`, and `initiativeId` attach the view to that container. `ownerId` sets the owning user.

Read back matching resources with the connection actions:

```ts
await linear.view.issues({ viewId: "view-id" });
await linear.view.projects({ viewId: "view-id" });
await linear.view.initiatives({ viewId: "view-id" });
await linear.view.updates({ viewId: "view-id" });
```
