import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as t from "typebox";
import { helpInputs, validateTypedInput } from "../plugin/schema.js";

/** Discovery exposes usable input shapes; validation accepts bare no-input calls. */
describe("action schema ergonomics", () => {
  describe("describe exposes nested shapes", () => {
    it("returns the item schema for an array of objects", () => {
      // Array item fields must be discoverable without a failed execution.
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

    it("discovers root object alternatives with conditional required fields", () => {
      const branches = [
        t.Object({
          kind: t.Literal("ref"),
          ref: t.String(),
          shared: t.String(),
        }),
        t.Object({
          kind: t.Literal("css"),
          selector: t.String(),
          shared: t.Optional(t.String()),
        }),
      ];
      for (const schema of [t.Union(branches), { oneOf: branches }]) {
        const fields = helpInputs(schema as never);
        assert.deepEqual(fields.kind.enum, ["ref", "css"]);
        assert.equal(fields.kind.required, true);
        assert.equal(fields.ref.required, false);
        assert.equal(fields.selector.required, false);
        assert.equal(fields.shared.required, false);
        assert.equal(fields.shared.variants, undefined);
      }
    });
    it("does not invent inherited fields in other alternatives", () => {
      const fields = helpInputs(
        t.Union([
          t.Object({ toString: t.String(), constructor: t.Number() }),
          t.Object({ other: t.String() }),
        ]),
      );
      for (const [name, type] of [
        ["toString", "string"],
        ["constructor", "number"],
      ]) {
        assert.equal(fields[name].type, type);
        assert.equal(fields[name].required, false);
        assert.equal(fields[name].variants, undefined);
      }
    });
    it("bounds recursive root unions and preserves nested alternatives", () => {
      const recursive: Record<string, unknown> = {};
      recursive.anyOf = [recursive, t.Object({ value: t.String() })];
      assert.equal(helpInputs(recursive as never).value.required, false);
      const nested = helpInputs({
        type: "object",
        properties: { choice: recursive },
      } as never);
      assert.ok(nested.choice.displayType?.includes("unknown"));
      assert.ok(nested.choice.variants);
      const fields = helpInputs(
        t.Union([
          t.Object({ value: t.Object({ a: t.String() }) }),
          t.Object({ value: t.Object({ b: t.Number() }) }),
        ]),
      );
      assert.equal(fields.value.required, true);
      assert.equal(fields.value.variants?.length, 2);
      assert.equal(fields.value.variants?.[0].properties?.a.type, "string");
      assert.deepEqual(helpInputs(t.Union([t.String(), t.Number()])), {});
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

    it("survives a schema that refers to itself", () => {
      // Self-referential schemas exist in the wild; describe must not
      // hang or blow the stack on one. Reaching the assertions at all is
      // most of the proof, so they check where it stopped, not just that
      // something came back.
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

      // Follow the cycle down and confirm it was cut off, not abandoned.
      // The cut lands on the array whose items went unread, not on the
      // object above it.
      let cursor = described.tree;
      let hops = 0;
      while (cursor.properties?.children?.items) {
        cursor = cursor.properties.children.items;
        hops++;
      }
      assert.ok(hops > 0, "must descend at least one level into the cycle");
      assert.ok(hops < 10, "must not follow the cycle indefinitely");
      assert.equal(cursor.properties?.children?.truncated, true);
    });
  });

  describe("zero-input actions accept a bare call", () => {
    const noInputs = t.Object({});

    it("treats a missing argument as an empty object", () => {
      // A bare no-input call is equivalent to an explicit empty object.
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
