/**
 * The Steel page tools, exercised against a real Chromium over real CDP.
 *
 * Mocking the protocol here would test almost nothing worth testing: the
 * whole point of this stack is that trusted input, ref stability, and
 * stale-ref detection behave like a browser, and a fake CDP endpoint
 * would agree with whatever the code did. So these tests launch a
 * browser, connect the plugin's own CDP client to it, and drive the
 * plugin's own driver and page bridge.
 *
 * Steel itself is not in the loop — it hosts the browser and mints the
 * websocket URL; everything below that is what runs here.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Browser, chromium } from "playwright";
import steel from "../../../runline-plugins/steel/src/index.js";
import {
  attachToPage,
  type CdpConnection,
  type CdpPage,
  connectCdp,
} from "../../../runline-plugins/steel/src/page/cdp.js";
import { CdpDriver } from "../../../runline-plugins/steel/src/page/driver.js";
import { createPluginAPI } from "../plugin/api.js";
import type { PluginDef } from "../plugin/types.js";

type Snapshot = { snapshot: string; url: string; title: string };
type Prepared = { editable: boolean; locatorToken: string };

const PAGE = `<!doctype html><html><body>
  <h1>Sign in</h1>
  <button id="go">Continue</button>
  <input id="name" value="initial">
  <input id="pw" type="password" value="hunter2">
  <select id="pick"><option value="a">Alpha</option><option value="b">Beta</option></select>
  <div id="log"></div>
  <script>
    document.getElementById('go').addEventListener('click', (e) => {
      document.getElementById('log').textContent =
        e.isTrusted ? 'trusted click' : 'synthetic click';
    });
  </script>
</body></html>`;

/**
 * A missing browser binary is an environment gap, not a failing test, so
 * the suite skips rather than reporting fourteen confusing failures. CI
 * installs chromium, so there it always runs.
 */
const browserAvailable = await chromium
  .launch()
  .then(async (instance) => {
    await instance.close();
    return true;
  })
  .catch(() => false);

if (!browserAvailable) {
  console.warn(
    "steel page tools: skipping — no chromium. Run `bunx playwright install chromium`.",
  );
}

(browserAvailable ? describe : describe.skip)("steel page tools", () => {
  let browser: Browser;
  let cdp: CdpConnection;
  let page: CdpPage;
  let driver: CdpDriver;

  before(async () => {
    const port = 9500 + Math.floor(Math.random() * 400);
    browser = await chromium.launch({
      args: [`--remote-debugging-port=${port}`],
    });
    const target = await browser.newPage();
    await target.setContent(PAGE);
    // Reach that same browser through the plugin's own CDP client, over
    // the same kind of websocket Steel hands out.
    const version = (await (
      await fetch(`http://127.0.0.1:${port}/json/version`)
    ).json()) as { webSocketDebuggerUrl: string };
    cdp = await connectCdp(version.webSocketDebuggerUrl);
    page = await attachToPage(cdp);
    driver = new CdpDriver(page);
  });

  after(async () => {
    driver?.dispose();
    cdp?.close();
    await browser?.close();
  });

  const snapshot = () => page.bridge<Snapshot>({ action: "snapshot" });
  const refFor = async (label: string) => {
    const { snapshot: tree } = await snapshot();
    const line = tree.split("\n").find((row) => row.includes(label));
    assert.ok(line, `expected the snapshot to contain ${label}\n${tree}`);
    const ref = /\[ref=(e\d+)\]/.exec(line)?.[1];
    assert.ok(ref, `expected a ref on: ${line}`);
    return ref;
  };

  it("registers every page action on the plugin", () => {
    const { api, resolve } = createPluginAPI("steel");
    steel(api);
    const plugin: PluginDef = resolve();
    const names = plugin.actions.map((action) => action.name);
    for (const expected of [
      "page.read",
      "page.click",
      "page.type",
      "page.getValue",
      "page.pressKey",
      "page.selectOption",
      "page.setCookies",
      "page.hover",
      "page.drag",
      "page.scroll",
      "page.waitFor",
      "page.navigate",
      "page.targets",
      "page.screenshot",
      "page.handleDialog",
    ]) {
      assert.ok(names.includes(expected), `missing action ${expected}`);
    }
  });

  it("captures an accessibility tree with element refs", async () => {
    const result = await snapshot();
    assert.match(result.snapshot, /heading "Sign in"/);
    assert.match(result.snapshot, /button "Continue" \[ref=e\d+\]/);
  });

  it("redacts password values in the snapshot", async () => {
    const result = await snapshot();
    assert.doesNotMatch(result.snapshot, /hunter2/);
    assert.match(result.snapshot, /\[REDACTED\]/);
  });

  it("keeps refs stable across repeated captures", async () => {
    const first = await snapshot();
    const second = await snapshot();
    assert.equal(first.snapshot, second.snapshot);
  });

  it("refuses a ref that is not in the current page", async () => {
    await assert.rejects(
      () => page.bridge({ action: "prepare_target", target: "e9999" }),
      /not present in the current page snapshot/,
    );
  });

  it("refuses an ambiguous selector rather than guessing", async () => {
    await assert.rejects(
      () => page.bridge({ action: "prepare_target", target: "input" }),
      /matched 2 elements/,
    );
  });

  it("dispatches input the page sees as trusted", async () => {
    const ref = await refFor('button "Continue"');
    const prepared = await page.bridge<Prepared>({
      action: "prepare_target",
      target: ref,
    });
    await driver.click(prepared, {});
    await driver.settle();
    const log = await page.evaluate<string>(
      "document.getElementById('log').textContent",
    );
    assert.equal(log, "trusted click");
  });

  it("types into a field and reports the value change", async () => {
    const prepared = await page.bridge<Prepared>({
      action: "prepare_editable",
      target: "#name",
      mode: "replace",
    });
    await driver.type(prepared, "replaced", {});
    const value = await page.bridge<{ value: string }>({
      action: "editable_value",
      target: "#name",
    });
    assert.equal(value.value, "replaced");
  });

  it("appends without destroying the existing value", async () => {
    await page.evaluate("document.getElementById('name').value = 'base'");
    const prepared = await page.bridge<Prepared>({
      action: "prepare_editable",
      target: "#name",
      mode: "append",
    });
    await driver.type(prepared, "-more", {});
    const value = await page.bridge<{ value: string }>({
      action: "editable_value",
      target: "#name",
    });
    assert.equal(value.value, "base-more");
  });

  it("reports a password value as sensitive", async () => {
    const value = await page.bridge<{ value: string; sensitive: boolean }>({
      action: "editable_value",
      target: "#pw",
    });
    assert.equal(value.sensitive, true);
  });

  it("refuses to type into a non-editable element", async () => {
    await assert.rejects(
      () =>
        page.bridge({
          action: "prepare_editable",
          target: "#go",
          mode: "replace",
        }),
      /does not accept text input/,
    );
  });

  it("selects an option by label and fires change", async () => {
    const resolved = await page.bridge<{ selected: string[] }>({
      action: "resolve_options",
      target: "#pick",
      values: ["Beta"],
    });
    assert.deepEqual(resolved.selected, ["b"]);
    const prepared = await page.bridge<Prepared>({
      action: "prepare_target",
      target: "#pick",
    });
    await driver.select(prepared, resolved.selected);
    const value = await page.evaluate<string>(
      "document.getElementById('pick').value",
    );
    assert.equal(value, "b");
  });

  it("refuses an option that does not exist", async () => {
    await assert.rejects(
      () =>
        page.bridge({
          action: "resolve_options",
          target: "#pick",
          values: ["Gamma"],
        }),
      /Could not match all requested options/,
    );
  });

  it("treats an unmet wait as a timeout result, not an error", async () => {
    const outcome = await page.bridge<{
      matched: boolean;
      timedOut: boolean;
      elapsedMs: number;
    }>({ action: "wait_for", text: "never appears", time: 0.3 });
    assert.equal(outcome.matched, false);
    assert.equal(outcome.timedOut, true);
    assert.ok(outcome.elapsedMs >= 0);
  });

  it("matches a wait for text already present", async () => {
    const outcome = await page.bridge<{ matched: boolean; timedOut: boolean }>({
      action: "wait_for",
      text: "Sign in",
      time: 1,
    });
    assert.equal(outcome.matched, true);
    assert.equal(outcome.timedOut, false);
  });

  it("refuses an unknown modifier instead of silently dropping all of them", async () => {
    // A bad name used to fold into the bitmask as undefined, making the
    // whole mask NaN, which CDP reads as no modifiers at all.
    const ref = await refFor('button "Continue"');
    const prepared = await page.bridge<Prepared>({
      action: "prepare_target",
      target: ref,
    });
    await assert.rejects(
      () => driver.click(prepared, { modifiers: ["Command"] as never }),
      /Unknown modifier Command/,
    );
    await assert.rejects(() => driver.press("Cmd+Enter"), /Unknown modifier/);
  });

  it("reports a vanished select as a stale ref, not a page error", async () => {
    const prepared = await page.bridge<Prepared>({
      action: "prepare_target",
      target: "#pick",
    });
    await page.evaluate("document.getElementById('pick').remove()");
    await assert.rejects(
      () => driver.select(prepared, ["a"]),
      /left the page between preparing and acting/,
    );
    // Put it back for any later test that reads the tree.
    await page.evaluate(
      "document.body.insertAdjacentHTML('beforeend', '<select id=pick><option value=a>Alpha</option></select>')",
    );
  });

  it("captures a screenshot as base64 jpeg", async () => {
    const shot = await driver.screenshot({});
    assert.equal(shot.mimeType, "image/jpeg");
    assert.ok(shot.data.length > 100);
  });

  it("writes cookies the server then sees", async () => {
    await page.send("Network.setCookies", {
      cookies: [
        { name: "auth", value: "tok-1", domain: "example.test", path: "/" },
      ],
    });
    const { cookies } = (await page.send("Network.getCookies", {
      urls: ["https://example.test/"],
    })) as { cookies: Array<{ name: string; value: string }> };
    assert.equal(cookies.find((c) => c.name === "auth")?.value, "tok-1");
  });

  it("reinstalls the bridge after the page world is destroyed", async () => {
    await page.evaluate("delete window.__steelPageBridge");
    // The next bridge call must self-heal rather than fail.
    const result = await snapshot();
    assert.match(result.snapshot, /heading "Sign in"/);
  });
});
