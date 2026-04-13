import type { RunlinePluginAPI } from "runline";

export default function openThesaurus(rl: RunlinePluginAPI) {
  rl.setName("openThesaurus");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({});

  rl.registerAction("synonyms.get", {
    description: "Get synonyms for a German word (OpenThesaurus API, no auth required)",
    inputSchema: {
      text: { type: "string", required: true, description: "German word to look up" },
      baseform: { type: "boolean", required: false, description: "Return base form of search term" },
      similar: { type: "boolean", required: false, description: "Return similarly written words" },
      startswith: { type: "boolean", required: false, description: "Only match words starting with term" },
      substring: { type: "boolean", required: false, description: "Match partial words" },
      subsynsets: { type: "boolean", required: false, description: "Include sub-terms" },
      supersynsets: { type: "boolean", required: false, description: "Include generic terms" },
    },
    async execute(input) {
      const p = (input ?? {}) as Record<string, unknown>;
      const url = new URL("https://www.openthesaurus.de/synonyme/search");
      url.searchParams.set("q", p.text as string);
      url.searchParams.set("format", "application/json");
      for (const key of ["baseform", "similar", "startswith", "substring", "subsynsets", "supersynsets"]) {
        if (p[key]) url.searchParams.set(key, "true");
      }
      const res = await fetch(url.toString(), { headers: { "User-Agent": "runline" } });
      if (!res.ok) throw new Error(`OpenThesaurus error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.synsets;
    },
  });
}
