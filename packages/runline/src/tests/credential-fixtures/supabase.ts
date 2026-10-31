import supabase from "../../../../runline-plugins/supabase/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: supabase,
  name: "supabase",
  config: { host: "https://proj.supabase.co", serviceRole: "sb_service" },
  secrets: ["serviceRole"],
  action: "row.get",
  input: { table: "todos", filters: { id: "eq.5" } },
  response: [{ id: 5 }],
  target: "rest",
  wire: {
    url: "https://proj.supabase.co/rest/v1/todos?id=eq.5",
    header: ["apikey", "sb_service"],
  },
} satisfies CredentialFixture;
