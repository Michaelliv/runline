import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { renderEmailJsx } from "../../../runline-plugins/_shared/emailJsx.js";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import { Runline } from "../sdk.js";

const gmailActions = Runline.create({ plugins: [gmail] }).actions();
const sendSchema = gmailActions.find((e) => e.action === "message.send")
  ?.inputSchema as TSchema;
assert.ok(sendSchema, "missing input schema for gmail.message.send");

const HEBREW_JSX = `<Html dir="rtl" lang="he">
  <Container>
    <Heading>שלום דנה</Heading>
    <Text>הפגישה נקבעה ליום שלישי ב-14:00.</Text>
    <Button href="https://example.com/confirm">אישור הגעה</Button>
  </Container>
</Html>`;

describe("gmail message.send jsx schema", () => {
  it("accepts a jsx-only body", () => {
    assert.ok(
      Check(sendSchema, { to: "a@b.com", subject: "s", jsx: "<Html />" }),
    );
  });

  it("rejects jsx together with html", () => {
    assert.ok(
      !Check(sendSchema, {
        to: "a@b.com",
        subject: "s",
        jsx: "<Html />",
        html: "<p>x</p>",
      }),
    );
  });

  it("rejects whitespace-only jsx as the sole body", () => {
    assert.ok(!Check(sendSchema, { to: "a@b.com", subject: "s", jsx: "  " }));
  });
});

describe("renderEmailJsx", () => {
  it("renders RTL Hebrew into client-safe HTML with a text fallback", async () => {
    const { html, text } = await renderEmailJsx(HEBREW_JSX);
    assert.ok(html.startsWith("<!DOCTYPE"));
    assert.match(html, /<html dir="rtl" lang="he">/);
    // React Email's table layout is the cross-client consistency story.
    assert.match(html, /<table[^>]*role="presentation"/);
    assert.match(html, /שלום דנה/);
    assert.match(text, /שלום דנה/);
    assert.match(text, /https:\/\/example\.com\/confirm/);
  });

  it("explicit text is preserved; generated text is only a fallback", async () => {
    // Covered at the plugin level: execute uses `text ??= rendered.text`.
    // Here assert the renderer always produces a non-empty fallback.
    const { text } = await renderEmailJsx("<Text>hello</Text>");
    assert.equal(text.trim(), "hello");
  });

  it("fails loudly on malformed jsx", async () => {
    await assert.rejects(
      renderEmailJsx("<Html><Unclosed></Html>"),
      /jsx (parse|evaluation) failed/,
    );
  });

  it("rejects statement-level code", async () => {
    await assert.rejects(renderEmailJsx("const x = 1"), /jsx parse failed/);
  });

  it("names available components when one is unknown", async () => {
    await assert.rejects(
      renderEmailJsx("<Bogus />"),
      (err: Error) =>
        /jsx evaluation failed: Bogus is not defined/.test(err.message) &&
        /Available components: .*Button.*/.test(err.message),
    );
  });

  it("rejects non-element results", async () => {
    await assert.rejects(
      renderEmailJsx('"just a string"'),
      /must evaluate to a single React element/,
    );
  });

  it("rejects empty input", async () => {
    await assert.rejects(renderEmailJsx("   "), /jsx body is empty/);
  });
});
