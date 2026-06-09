# Steel Runline plugin

Runline actions for Steel cloud browsers, browser tools, files, credentials, profiles, extensions, CAPTCHAs, and session traces.

## Connection

```json
{
  "plugin": "steel",
  "config": {
    "apiKey": "$STEEL_API_KEY"
  }
}
```

The connection schema declares `apiKey` with env metadata for `STEEL_API_KEY`. Actions read `ctx.connection.config.apiKey`; they do not read `process.env` directly.

## Common workflows

Create a session, connect to it from Playwright/Puppeteer with the returned `websocketUrl` or `session.cdpUrl`, then release it when done:

```js
const session = await steel.session.create({
  solveCaptcha: true,
  useProxy: true,
  timeout: 600000,
});

const { cdpUrl } = await steel.session.cdpUrl({
  id: session.id,
  websocketUrl: session.websocketUrl,
});

// Use cdpUrl from your browser automation runtime.
await steel.session.release({ id: session.id });
```

For one-shot reads, use the browser tool endpoints instead of managing a session:

```js
await steel.scrape({
  url: "https://example.com",
  format: ["markdown"],
  delay: 1000,
});

await steel.screenshot({ url: "https://example.com", fullPage: true });
await steel.pdf({ url: "https://example.com" });
```

`browser.run` is the high-level code-mode action. It creates a session, dynamically imports Playwright from the host app, exposes `{ page, browser, context, session }` to your script, and releases the session by default:

```js
await steel.browser.run({
  script: `
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    return { title: await page.title(), url: page.url() };
  `,
});
```

Because Runline does not ship Playwright as a dependency, hosts that use `browser.run` should install `playwright`. If Playwright CDP connection fails, `browser.run` falls back to a minimal CDP page surface for basic navigation and extraction. Hosts that do not want browser code execution can use `session.create` plus `session.cdpUrl`.

For model-native computer-use loops, call `session.computer` directly with Steel input actions. It forwards actions such as `take_screenshot`, `click_mouse`, `type_text`, `press_key`, `scroll`, and `drag_mouse` to the live session:

```js
const session = await steel.session.create({
  dimensions: { width: 1280, height: 768 },
  timeout: 600000,
});

const screenshot = await steel.session.computer({
  id: session.id,
  action: "take_screenshot",
});

await steel.session.release({ id: session.id });
```

Recorded-session helpers are also exposed. `session.events` fetches legacy replay events, and `session.hls` fetches the headful recording playlist when Steel has generated one for the session. A very fresh or unrecorded session can return `404 Playlist not found` from the HLS endpoint.

## Action groups

- `session.*` — create, list, get, release, release all, capture auth context, fetch traces/events/HLS, execute computer-use actions, build CDP URLs
- `scrape`, `screenshot`, `pdf` — one-shot browser tools
- `browser.run` — Playwright code-mode browser action
- `sessionFile.*` — upload/list/download/delete files in a live session filesystem
- `file.*` — global organization file store
- `credential.*` — credentials vault management
- `profile.*` — profile management and metadata updates
- `extension.*` — upload/list/update/delete Chrome extensions
- `captcha.*` — status, solve, and image solve

Binary uploads and downloads are awkward through JSON-only agent actions. For zip/crx/userDataDir uploads or raw file downloads, use the Steel API/SDK directly; the Runline actions cover URL/path-based workflows and metadata/control operations.
