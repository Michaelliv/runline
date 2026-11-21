# Vercel plugin

Set `VERCEL_TOKEN` to a Vercel access token from <https://vercel.com/account/settings/tokens>. Personal-account resources work with only the token. Team-owned resources usually need `VERCEL_TEAM_ID` or per-call `teamId`; the plugin appends the configured team scope to every request.

```json
{
  "connections": [
    {
      "name": "vercel",
      "plugin": "vercel",
      "config": {
        "token": "vcp_...",
        "teamId": "team_..."
      }
    }
  ]
}
```

Examples:

```ts
await vercel.whoami();

const projects = await vercel.project.list({ limit: 20 });
const deployments = await vercel.deployment.list({ projectId: "prj_...", state: "ERROR,READY", limit: 10 });

const buildLogs = await vercel.deployment.logs({
  idOrUrl: "dpl_...",
  builds: 1,
  limit: 100,
  direction: "backward",
});

const runtimeLogs = await vercel.deployment.runtimeLogs({
  projectId: "prj_...",
  deploymentId: "dpl_...",
  since: Date.now() - 30 * 60 * 1000,
});

await vercel.env.set({
  projectIdOrName: "my-app",
  key: "API_URL",
  value: "https://api.example.com",
  type: "encrypted",
  target: "production",
});

await vercel.env.delete({ projectIdOrName: "my-app", id: "env_..." });
```

`env.set` creates when `id` is omitted and updates when `id` is provided. Creates require `key`, `value`, `type`, and either `target` or `customEnvironmentIds`; string `target` values are normalized to Vercel's required array shape. Be explicit about `target` and `gitBranch`; environment variable writes affect the selected project/environment scope and usually require a redeploy before deployed code sees the new value.
