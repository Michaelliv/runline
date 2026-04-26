# vendor

Third-party bundles inlined into the QuickJS sandbox at runtime.

These files are committed deliberately: the sandbox eval'd source is part of runline's behavior, and PR diffs should show exactly what changes when a bundle is bumped.

## minisearch.umd.js

UMD build of [minisearch](https://github.com/lucaong/minisearch). Read by `src/core/engine.ts` and inlined into the sandbox so `MiniSearch` is available as a global to agent code (powers `actions.find()`).

To upgrade:

```bash
npm i -D minisearch@latest
cp node_modules/minisearch/dist/umd/index.js vendor/minisearch.umd.js
git commit -am "vendor: bump minisearch"
```

The `minisearch` devDependency exists only as a convenience for that `cp` — nothing imports it at runtime.
