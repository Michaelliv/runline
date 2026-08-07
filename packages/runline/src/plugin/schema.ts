import { Check, Errors } from "typebox/value";
import type {
  ConnectionSchema,
  HelpInput,
  InputSchema,
  LegacyConnectionSchema,
  LegacyInputSchema,
  TypedInputSchema,
} from "./types.js";

interface SchemaMetadata {
  type?: string;
  properties?: Record<string, SchemaMetadata>;
  items?: SchemaMetadata;
  required?: string[];
  anyOf?: SchemaMetadata[];
  oneOf?: SchemaMetadata[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  env?: string;
}

/**
 * How deep `describe` will follow a schema. Nesting past this is
 * vanishingly rare, and a self-referential schema would otherwise
 * recurse until the stack gave out. A field cut off here says so, so
 * that "no properties" and "stopped looking" stay distinguishable.
 */
const MAX_DESCRIBE_DEPTH = 5;

/**
 * The alternatives of a union, however the schema spells it. TypeBox
 * emits `anyOf`; hand-written schemas in the plugins use `oneOf`. Every
 * reader here has to treat them the same, so they are unified once.
 */
function branchesOf(schema: SchemaMetadata): SchemaMetadata[] | undefined {
  const branches = schema.anyOf ?? schema.oneOf;
  return branches?.length ? branches : undefined;
}

export interface ValidationResult {
  ok: boolean;
  missing: string[];
  unknown: string[];
  typeErrors: Array<{ field: string; expected: string; actual: string }>;
  errors: string[];
}

export function isTypedInputSchema(
  schema: InputSchema | undefined,
): schema is TypedInputSchema {
  if (!schema || typeof schema !== "object") return false;
  const candidate = schema as SchemaMetadata;
  // A bare union is a typed schema too. Missing that here would classify
  // it as legacy and iterate its JSON Schema keywords as field names.
  return typeof candidate.type === "string" || Boolean(branchesOf(candidate));
}

export function legacyFields(
  schema: InputSchema | undefined,
): LegacyInputSchema {
  if (!schema || isTypedInputSchema(schema)) return {};
  return schema;
}

export function connectionFields(
  schema: ConnectionSchema | undefined,
): LegacyConnectionSchema {
  if (!schema) return {};
  if (!isTypedInputSchema(schema)) return schema;

  const metadata = schema as SchemaMetadata;
  if (metadata.type !== "object") return {};
  const required = new Set(metadata.required ?? []);
  return Object.fromEntries(
    Object.entries(metadata.properties ?? {}).map(([key, field]) => [
      key,
      {
        type: baseType(field),
        required: required.has(key),
        description: field.description,
        default: field.default,
        env: field.env,
      },
    ]),
  );
}

export function helpInputs(
  schema: InputSchema | undefined,
): Record<string, HelpInput> {
  if (!schema) return {};
  if (!isTypedInputSchema(schema)) {
    const legacy = schema as LegacyInputSchema;
    return Object.fromEntries(
      Object.entries(legacy).map(([key, field]) => [
        key,
        {
          type: field.type,
          required: !!field.required,
          description: field.description,
        },
      ]),
    );
  }

  const metadata = schema as SchemaMetadata;
  if (metadata.type !== "object") return {};
  return describeProperties(metadata, 0);
}

function describeProperties(
  schema: SchemaMetadata,
  depth: number,
): Record<string, HelpInput> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, field]) => [
      key,
      describeField(field, required.has(key), depth),
    ]),
  );
}

/**
 * Describe one input, following arrays into their item shape, objects
 * into their properties, and unions into each branch.
 *
 * A parameter typed only as "array" tells an agent nothing about what to
 * put in it, so the shape has to be guessed and the first call is a coin
 * flip. "object | object" is the same dead end wearing a union: two
 * shapes are on offer and neither is shown. Reporting the nested shape
 * is the difference between describe being documentation and being a
 * type name.
 */
function describeField(
  field: SchemaMetadata,
  required: boolean,
  depth: number,
): HelpInput {
  const described: HelpInput = {
    type: baseType(field),
    displayType: displayType(field),
    required,
    description: field.description,
    enum: enumValues(field),
    const: field.const,
  };

  const branches = unionBranches(field);
  if (depth >= MAX_DESCRIBE_DEPTH) {
    // Only claim truncation where something was actually left unread.
    if (field.items || field.properties || branches) described.truncated = true;
    return described;
  }

  if (field.items) {
    // An array element is not "required"; the flag has no meaning here.
    described.items = describeField(field.items, false, depth + 1);
  }
  if (field.properties) {
    described.properties = describeProperties(field, depth + 1);
  }
  if (branches) {
    described.variants = branches.map((branch) =>
      describeField(branch, false, depth + 1),
    );
  }
  return described;
}

/**
 * The branches of a union worth describing individually.
 *
 * Two unions need no expansion. A union of literals is already fully
 * described by `enum`, and a union of bare scalars is already fully
 * described by `displayType` — `string | null` is Linear's clearable
 * pattern and repeating it as two empty branches only buries the unions
 * that do carry shape.
 */
function unionBranches(field: SchemaMetadata): SchemaMetadata[] | undefined {
  const branches = branchesOf(field);
  if (!branches) return undefined;
  if (enumValues(field)) return undefined;
  return branches.some(hasShape) ? branches : undefined;
}

/** Whether a schema says more than its type name does. */
function hasShape(schema: SchemaMetadata): boolean {
  return Boolean(
    schema.properties ||
      schema.items ||
      branchesOf(schema) ||
      schema.enum?.length ||
      schema.description,
  );
}

export function validateLegacyInput(
  schema: LegacyInputSchema,
  input: unknown,
): ValidationResult {
  const provided =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const missing: string[] = [];
  const unknown: string[] = [];
  const typeErrors: ValidationResult["typeErrors"] = [];

  for (const [key, spec] of Object.entries(schema)) {
    if (spec.required && !(key in provided)) missing.push(key);
  }
  for (const key of Object.keys(provided)) {
    if (!(key in schema)) {
      unknown.push(key);
      continue;
    }
    const expected = schema[key].type;
    const actual = valueType(provided[key]);
    if (
      provided[key] !== null &&
      provided[key] !== undefined &&
      expected !== actual
    ) {
      typeErrors.push({ field: key, expected, actual });
    }
  }

  return validationResult({ missing, unknown, typeErrors });
}

/**
 * A call written with no arguments is a call with an empty argument set.
 *
 * `linear.user.me()` is the most natural way to invoke an action that
 * takes nothing, and validating `undefined` against an object schema
 * rejected it every time. It also made a genuinely missing input report
 * "must be object" instead of naming the field.
 *
 * Only `undefined` is normalized: an explicit `null` or `42` is an
 * argument, and a wrong one.
 */
export function normalizeActionInput(input: unknown): unknown {
  return input === undefined ? {} : input;
}

export function validateTypedInput(
  schema: TypedInputSchema,
  rawInput: unknown,
): ValidationResult {
  const input = normalizeActionInput(rawInput);
  if (Check(schema, input)) return validationResult({});

  return validationResult({
    errors: [...Errors(schema, input)].map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message}`;
    }),
  });
}

export function formatValidationError(
  path: string,
  result: ValidationResult,
): string {
  const parts = [`Invalid input for ${path}.`];
  if (result.missing.length > 0) {
    parts.push(`Missing required fields: ${result.missing.join(", ")}.`);
  }
  if (result.unknown.length > 0) {
    parts.push(`Unknown fields: ${result.unknown.join(", ")}.`);
  }
  if (result.typeErrors.length > 0) {
    parts.push(
      `Type errors: ${result.typeErrors
        .map((e) => `${e.field} expected ${e.expected}, got ${e.actual}`)
        .join("; ")}.`,
    );
  }
  if (result.errors.length > 0) {
    parts.push(`Validation errors: ${result.errors.join("; ")}.`);
  }
  return parts.join(" ");
}

function validationResult(input: {
  missing?: string[];
  unknown?: string[];
  typeErrors?: ValidationResult["typeErrors"];
  errors?: string[];
}): ValidationResult {
  const missing = input.missing ?? [];
  const unknown = input.unknown ?? [];
  const typeErrors = input.typeErrors ?? [];
  const errors = input.errors ?? [];
  return {
    ok:
      missing.length === 0 &&
      unknown.length === 0 &&
      typeErrors.length === 0 &&
      errors.length === 0,
    missing,
    unknown,
    typeErrors,
    errors,
  };
}

function displayType(schema: SchemaMetadata): string {
  const branches = branchesOf(schema);
  if (branches) return branches.map(displayType).join(" | ");
  if (schema.enum?.length) return schema.enum.map(String).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  return schema.type ?? "unknown";
}

function baseType(schema: SchemaMetadata): string {
  const branches = branchesOf(schema);
  if (branches) {
    const types = [...new Set(branches.map(baseType))];
    return types.length === 1 ? types[0] : types.join(" | ");
  }
  if (schema.type) return schema.type;
  if (schema.const !== undefined) return valueType(schema.const);
  return "unknown";
}

function enumValues(schema: SchemaMetadata): unknown[] | undefined {
  if (schema.enum?.length) return schema.enum;
  const branches = branchesOf(schema);
  if (branches?.every((s) => s.const !== undefined)) {
    return branches.map((s) => s.const);
  }
  return undefined;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
