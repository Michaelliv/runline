/**
 * Render agent-authored React Email JSX into wire-ready email HTML
 * plus a plain-text alternative.
 *
 * Why JSX instead of hand-written HTML: email-grade HTML (table
 * layouts, inlined styles, client quirks) is exactly what agents get
 * wrong; @react-email/components encodes that knowledge, and agents
 * write JSX fluently. Evaluating agent-supplied JSX adds no new risk
 * class — runline's executor is already a coding surface.
 *
 * All heavy dependencies (react, sucrase, react-email) load lazily on
 * first use so plugins that never render JSX pay nothing at startup.
 */

type Rendered = { html: string; text: string };

type ReactEmailModules = {
  React: typeof import("react");
  components: Record<string, unknown>;
  render: (
    element: import("react").ReactElement,
    options?: { plainText?: boolean },
  ) => Promise<string>;
  transform: typeof import("sucrase").transform;
};

let modulesPromise: Promise<ReactEmailModules> | undefined;

async function loadModules(): Promise<ReactEmailModules> {
  modulesPromise ??= Promise.all([
    import("react"),
    import("@react-email/components"),
    import("@react-email/render"),
    import("sucrase"),
  ]).then(([react, components, renderMod, sucrase]) => ({
    React: react.default ?? react,
    components: components as unknown as Record<string, unknown>,
    render: renderMod.render,
    transform: sucrase.transform,
  }));
  return modulesPromise;
}

/**
 * Components become named parameters of the evaluation function, so
 * only exports that are valid JS identifiers (the React components —
 * capitalized) can be exposed. Lowercase utility exports are omitted
 * on purpose: the JSX surface is components-only.
 */
function componentScope(
  components: Record<string, unknown>,
): { names: string[]; values: unknown[] } {
  const names: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(components)) {
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(key)) continue;
    names.push(key);
    values.push(value);
  }
  return { names, values };
}

export async function renderEmailJsx(jsx: string): Promise<Rendered> {
  const source = jsx.trim();
  if (!source) throw new Error("jsx body is empty");
  const { React, components, render, transform } = await loadModules();

  let compiled: string;
  try {
    // Wrap as an expression statement so a bare `<Html>…</Html>` is a
    // valid program for sucrase; the parentheses also reject
    // statement-level code (const/if/etc.), keeping the surface to a
    // single JSX expression.
    compiled = transform(`__element = (${source});`, {
      transforms: ["jsx"],
      production: true,
    }).code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`jsx parse failed: ${msg}`);
  }

  const { names, values } = componentScope(components);
  let element: unknown;
  try {
    const fn = new Function(
      "React",
      ...names,
      `let __element; ${compiled}; return __element;`,
    );
    element = fn(React, ...values);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `jsx evaluation failed: ${msg}. Available components: ${names.join(", ")}`,
    );
  }

  if (!React.isValidElement(element)) {
    throw new Error("jsx must evaluate to a single React element");
  }

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}
