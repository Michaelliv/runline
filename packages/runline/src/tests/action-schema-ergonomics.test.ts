import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as t from "typebox";
import { helpInputs, validateTypedInput } from "../plugin/schema.js";

/**
 * Three ways an agent's *first* call to an unfamiliar action fails even
 * after consulting `actions.describe`. Each one costs a failed call and a
 * retry, and none of them is the agent's fault.
 */
describe("action schema ergonomics", () => {
  describe("describe exposes nested shapes", () => {
    it("returns the item schema for an array of objects", () => {
      // The shape that started this: fields[] described as a bare
      // "array", so the only way to learn it wanted `name` (not `key`)
      // was to call it wrong and read the validation error.
      const schema = t.Object({
        fields: t.Array(
          t.Object({
            name: t.String({ description: "Env var name." }),
            label: t.String(),
            multiline: t.Optional(t.Boolean()),
          }),
          { description: "Fields to render in the secure form." },
        ),
      });

      const items = helpInputs(schema).fields.items;
      assert.ok(items, "array inputs must describe their item shape");
      assert.equal(items.type, "object");
      assert.deepEqual(Object.keys(items.properties ?? {}).sort(), [
        "label",
        "multiline",
        "name",
      ]);
      assert.equal(items.properties?.name.required, true);
      assert.equal(items.properties?.name.description, "Env var name.");
      assert.equal(items.properties?.multiline.required, false);
    });

    it("returns nested properties for an object input", () => {
      const schema = t.Object({
        filter: t.Object({
          state: t.Optional(t.Union([t.Literal("open"), t.Literal("done")])),
          limit: t.Optional(t.Number()),
        }),
      });

      const filter = helpInputs(schema).filter;
      assert.equal(filter.type, "object");
      assert.deepEqual(Object.keys(filter.properties ?? {}).sort(), [
        "limit",
        "state",
      ]);
      assert.deepEqual(filter.properties?.state.enum, ["open", "done"]);
    });

    it("describes arrays of scalars without inventing properties", () => {
      const schema = t.Object({ tags: t.Array(t.String()) });
      const tags = helpInputs(schema).tags;
      assert.equal(tags.items?.type, "string");
      assert.equal(tags.items?.properties, undefined);
    });

    it("describes each branch of a union of object shapes", () => {
      // A union reported as "object | object" is the same dead end as a
      // bare "array": two shapes are on offer and neither is shown.
      const schema = t.Object({
        target: t.Union([
          t.Object({ kind: t.Literal("ref"), ref: t.String() }),
          t.Object({ kind: t.Literal("css"), selector: t.String() }),
        ]),
      });

      const variants = helpInputs(schema).target.variants;
      assert.equal(variants?.length, 2);
      assert.deepEqual(Object.keys(variants?.[0].properties ?? {}).sort(), [
        "kind",
        "ref",
      ]);
      assert.deepEqual(Object.keys(variants?.[1].properties ?? {}).sort(), [
        "kind",
        "selector",
      ]);
    });

    it("describes oneOf branches too, which plugins also use", () => {
      const described = helpInputs({
        type: "object",
        properties: {
          span: {
            oneOf: [
              { type: "object", properties: { all: { type: "boolean" } } },
              { type: "object", properties: { from: { type: "string" } } },
            ],
          },
        },
      } as never);
      assert.equal(described.span.variants?.length, 2);
    });

    it("leaves a nullable scalar alone — the display type already says it", () => {
      // `string | null` is Linear's clearable-field pattern, used on
      // roughly ten inputs. Listing two shapeless branches for it is
      // noise that buries the unions that do carry shape.
      const schema = t.Object({
        assigneeId: t.Optional(t.Union([t.String(), t.Null()])),
      });
      const described = helpInputs(schema).assigneeId;
      assert.equal(described.displayType, "string | null");
      assert.equal(described.variants, undefined);
    });

    it("keeps variants when a branch carries shape the display type cannot", () => {
      const schema = t.Object({
        attendees: t.Union([t.String(), t.Array(t.String())]),
      });
      const described = helpInputs(schema).attendees;
      assert.equal(described.variants?.length, 2);
      assert.equal(described.variants?.[1].items?.type, "string");
    });

    it("leaves a plain enum union as an enum, not a pile of variants", () => {
      // t.Union of literals is already fully described by `enum`; adding
      // a variant per literal would be noise.
      const schema = t.Object({
        state: t.Union([t.Literal("open"), t.Literal("done")]),
      });
      const state = helpInputs(schema).state;
      assert.deepEqual(state.enum, ["open", "done"]);
      assert.equal(state.variants, undefined);
    });

    it("says so when it stops descending, rather than looking empty", () => {
      // An object reported with no properties must not be ambiguous
      // between "has none" and "I stopped looking".
      let deep: unknown = t.Object({ leaf: t.String() });
      for (let i = 0; i < 7; i++) deep = t.Object({ next: deep as never });

      let node = helpInputs(t.Object({ root: deep as never })).root;
      while (node.properties?.next) node = node.properties.next;
      assert.equal(node.truncated, true, "the cut-off node must admit it");

      const shallow = helpInputs(t.Object({ empty: t.Object({}) })).empty;
      assert.equal(shallow.truncated, undefined);
    });

    it("stops descending rather than recursing forever", () => {
      // Self-referential schemas exist in the wild; describe must not
      // hang or blow the stack on one.
      const node: Record<string, unknown> = {
        type: "object",
        properties: { name: { type: "string" } },
      };
      (node.properties as Record<string, unknown>).children = {
        type: "array",
        items: node,
      };
      const described = helpInputs({
        type: "object",
        properties: { tree: node },
      } as never);
      assert.ok(described.tree);
    });
  });

  describe("zero-input actions accept a bare call", () => {
    const noInputs = t.Object({});

    it("treats a missing argument as an empty object", () => {
      // `linear.user.me()` is the most natural way to write a call that
      // takes nothing, and it always failed.
      assert.equal(validateTypedInput(noInputs, undefined).ok, true);
      assert.equal(validateTypedInput(noInputs, {}).ok, true);
    });

    it("still refuses a missing argument when inputs are required", () => {
      // Omitting a required input is a real error and must stay one.
      const schema = t.Object({ id: t.String() });
      const result = validateTypedInput(schema, undefined);
      assert.equal(result.ok, false);
      assert.match(result.errors.join(" "), /id/);
    });

    it("does not let an explicit non-object through", () => {
      assert.equal(validateTypedInput(noInputs, 42).ok, false);
      assert.equal(validateTypedInput(noInputs, null).ok, false);
    });
  });
});
