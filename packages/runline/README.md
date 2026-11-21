# runline

The runline library and command-line interface, published on npm as [`runline`](https://www.npmjs.com/package/runline). See the [repository README](../../README.md) and the [documentation](../../docs/index.md) for installation and usage.

## Layout

| Path | Contents |
|---|---|
| `src/` | The engine, plugin API and loader, connections, credentials, package manager, and commands |
| `src/tests/` | The test suite |
| `scripts/` | Repository tooling, such as the generator for the bundled plugin table |
| `dist/plugins/` | The bundled plugins, copied from `packages/runline-plugins/dist` by the build |

## Scripts

Run these from this folder:

| Task | Command |
|---|---|
| Run the command-line interface from source | `bun run dev -- exec 'return 1 + 2'` |
| Compile the library and bundle the plugins | `bun run build` |
| Run the tests | `bun run test` |
| Typecheck the source and the tests | `bun run typecheck` |
| Lint and check formatting | `bun run check` |

`build` compiles `src/` with `tsc`, builds `runline-plugins`, and copies the result into `dist/plugins/`, so the published package contains every bundled plugin.

Regenerate the table in [`docs/bundled-plugins.md`](../../docs/bundled-plugins.md) after adding or changing a bundled plugin. The script reads the built plugins:

```bash
bun run build
node scripts/generate-plugin-table.js --write
```
