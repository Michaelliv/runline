import type { RunlinePluginAPI } from "runline";

export default function quickchart(rl: RunlinePluginAPI) {
  rl.setName("quickchart");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({});

  rl.registerAction("chart.create", {
    access: "write",
    description:
      "Generate a chart image URL via QuickChart.io (no auth required)",
    inputSchema: {
      type: {
        type: "string",
        required: true,
        description:
          "Chart type: bar, line, pie, doughnut, radar, scatter, etc.",
      },
      labels: {
        type: "object",
        required: true,
        description: "Array of label strings",
      },
      datasets: {
        type: "object",
        required: true,
        description:
          "Array of dataset objects [{label, data: [...], backgroundColor?, borderColor?}]",
      },
      width: {
        type: "number",
        required: false,
        description: "Chart width in pixels (default 500)",
      },
      height: {
        type: "number",
        required: false,
        description: "Chart height in pixels (default 300)",
      },
      backgroundColor: {
        type: "string",
        required: false,
        description: "Chart background color",
      },
      format: {
        type: "string",
        required: false,
        description: "Output format: png (default), svg, webp, pdf",
      },
    },
    async execute(input) {
      const p = (input ?? {}) as Record<string, unknown>;
      const chart = {
        type: p.type,
        data: { labels: p.labels, datasets: p.datasets },
      };
      const qs = new URLSearchParams();
      qs.set("chart", JSON.stringify(chart));
      if (p.width) qs.set("width", String(p.width));
      if (p.height) qs.set("height", String(p.height));
      if (p.backgroundColor)
        qs.set("backgroundColor", p.backgroundColor as string);
      if (p.format) qs.set("format", p.format as string);
      const url = `https://quickchart.io/chart?${qs.toString()}`;
      return { url, chart };
    },
  });
}
