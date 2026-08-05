# Steel page tools

A semantic, ref-addressed browser automation surface for Steel sessions:
read the page as an accessibility tree with stable element refs, act on
refs rather than CSS selectors, and get a fresh tree back after every
mutation.

## Why this exists next to `browser.run`

`browser.run` needs Playwright installed in the host app. When it was not,
the action used to silently fall back to a hand-rolled six-method shim
that answered to Playwright's names and implemented a fraction of its
behaviour — so scripts did not fail, they returned wrong results. That
fallback is gone: `browser.run` now either gets real Playwright or throws.

These tools are the answer for hosts without Playwright. They depend only
on CDP, which Steel always speaks.

## Shape

| Piece | Runs | Role |
|---|---|---|
| `tools.ts` | plugin | The 14 registered `steel.page.*` actions |
| `driver.ts` | plugin | Trusted input via `Input.dispatch*` over CDP |
| `cdp.ts` | plugin | Minimal CDP client; keeps the bridge installed |
| `entry.ts` | **page** | Bridge dispatch over the snapshot service |
| `page-snapshot.ts` | **page** | Snapshot capture, ref resolution, target preflight |
| `wait-for.ts` | **page** | Text appear/disappear polling |
| `vendor/aria-snapshot/` | **page** | Playwright's aria snapshot stack |
| `bundle.generated.ts` | — | The above three bundled into one IIFE |

Everything marked **page** is pure DOM code with no access to the Steel
API key, the CDP socket, or any plugin state.

## The bundle

`bundle.generated.ts` is a committed build artifact. Regenerate it after
changing anything in this directory:

```
bun run build:steel-page-bundle
```

It is committed rather than built on demand because `runline-plugins`
builds with `tsc --noCheck`, which transpiles but does not bundle, and the
bridge has to reach the browser as a single expression for
`Runtime.evaluate`. Committing it also keeps the plugin self-contained at
runtime — no host install, which is the failure this whole module exists
to avoid.

## Ref stability

Refs (`e12`) stay valid only while the aria-snapshot module's counter and
each element's cached `_ariaRef` survive between calls, so the bridge is
installed **once per execution context** and reused. `cdp.ts` reinstalls it
only when the world no longer has it — which is exactly navigation, where
fresh refs are the correct outcome. `Page.addScriptToEvaluateOnNewDocument`
covers pages that navigate themselves mid-action.

This is why the actions can be stateless: refs live in the page, not in
this process, so connecting per call costs nothing in ref continuity.

## Vendored code

`vendor/aria-snapshot/` is Microsoft Playwright's in-page accessibility
snapshot stack — the same code behind Playwright MCP's `browser_snapshot`.

- **Source**: https://github.com/microsoft/playwright @ `32e8fd98462d9f274c4b6368613731f1a12a482f` (2026-07-09)
- **License**: Apache-2.0 (the header in every file applies; do not remove)
Changes against upstream:

| Change | Reason |
|---|---|
| Dropped the assertion template matchers and the YAML template parser | Unused here, and the parser pulled in a `yaml` dependency |
| Password input values redacted before rendering | Snapshots are handed to an agent and logged |
| `.js` extensions on relative imports | This project resolves modules as `nodenext` |

To update: sparse-checkout the `packages/injected/src` and
`packages/isomorphic` paths above from the Playwright repo, re-apply those
three changes, bump the SHA, and regenerate the bundle.

Do not edit these files for style; keep the diff against upstream minimal.
Our own code lives outside `vendor/` and treats it as read-only.

## Known gaps

- **No cross-frame snapshots.** `page.read` covers the main frame; content
  inside iframes is not walked yet.
- **Dialogs need a live connection.** Actions connect per call, so a
  dialog opened by an earlier action is detected on reconnect with a short
  grace period rather than observed as it happens.
