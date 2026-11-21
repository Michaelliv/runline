# runline-plugins

The plugins bundled with runline. This workspace package is private and is not published. The `runline` build compiles it and copies the output into `packages/runline/dist/plugins/`, so every installation of `runline` contains all of them.

The plugins are a separate package so that they compile in their own pass, apart from the library.

## Add a plugin

1. Create `packages/runline-plugins/<name>/src/index.ts`. Runline finds bundled plugins by folder, so the folder name must be the plugin's name.
2. Default-export a function that receives a `RunlinePluginAPI`. See [Plugins](../../docs/plugins.md).
3. If the plugin calls an authenticated API, declare its credential and send every request through the credential helpers. See [Credentials](../../docs/credentials.md). Reuse `_shared/googleCredentials.ts` or `_shared/microsoftCredentials.ts` for a Google or Microsoft API.
4. Label every action with `access: "read"` or `access: "write"`. Use `write` for anything that creates, changes, deletes, sends, uploads, executes, triggers, imports, deploys, or may otherwise affect an external system.
5. Add an icon named `<name>.svg` or `<name>.png` to `icons/`.
6. Build and regenerate the plugin table:

```bash
bun --filter runline build
cd packages/runline && node scripts/generate-plugin-table.js --write
```

## Checks

`bun run check` runs `scripts/lint-plugin-access.ts`, which loads every plugin from source. It fails when:

- a plugin does not load
- an action has no `access` label
- an action whose verb mutates, such as `create`, `update`, `delete`, or `send`, is not labeled `write`
- a plugin's name differs from its folder name
