import type { RunlinePluginAPI } from "runline";
import { commandExists, syncExec } from "runline/utils/cli";

export default function docker(rl: RunlinePluginAPI) {
  rl.setName("docker");
  rl.setVersion("0.1.0");

  rl.onInit(() => {
    if (!commandExists("docker")) {
      rl.log.warn("docker not found on PATH — docker actions will be unavailable");
    }
  });

  rl.registerAction("containers.list", {
    description: "List Docker containers",
    inputSchema: {
      all: { type: "boolean", description: "Include stopped containers", required: false },
    },
    execute(input) {
      const opts = (input as { all?: boolean }) ?? {};
      const args = ["ps", "--format", "{{json .}}", "--no-trunc"];
      if (opts.all) args.push("--all");
      const { rows } = syncExec("docker", args, { parser: "jsonlines" });
      return rows.map((r) => ({
        id: r.ID ?? r.id ?? "",
        name: ((r.Names ?? r.names ?? "") as string).replace(/^\//, ""),
        image: r.Image ?? r.image ?? "",
        status: r.Status ?? r.status ?? "",
        state: r.State ?? r.state ?? "",
        ports: r.Ports ?? r.ports ?? "",
      }));
    },
  });

  rl.registerAction("containers.start", {
    description: "Start a Docker container",
    inputSchema: {
      id: { type: "string", description: "Container ID or name", required: true },
    },
    execute(input) {
      const { id } = input as { id: string };
      syncExec("docker", ["start", id]);
      return { ok: true, id };
    },
  });

  rl.registerAction("containers.stop", {
    description: "Stop a Docker container",
    inputSchema: {
      id: { type: "string", description: "Container ID or name", required: true },
    },
    execute(input) {
      const { id } = input as { id: string };
      syncExec("docker", ["stop", id]);
      return { ok: true, id };
    },
  });

  rl.registerAction("images.list", {
    description: "List Docker images",
    execute() {
      const { rows } = syncExec(
        "docker",
        ["images", "--format", "{{json .}}", "--no-trunc"],
        { parser: "jsonlines" },
      );
      return rows.map((r) => ({
        id: r.ID ?? r.id ?? "",
        repository: r.Repository ?? r.repository ?? "",
        tag: r.Tag ?? r.tag ?? "",
        size: r.Size ?? r.size ?? "",
      }));
    },
  });

  rl.registerAction("images.pull", {
    description: "Pull a Docker image",
    inputSchema: {
      image: { type: "string", description: "Image name (e.g. nginx:latest)", required: true },
    },
    execute(input) {
      const { image } = input as { image: string };
      syncExec("docker", ["pull", image]);
      return { ok: true, image };
    },
  });
}
