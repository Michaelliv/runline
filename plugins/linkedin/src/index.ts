import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.linkedin.com";

async function apiRequest(
  token: string, method: string, endpoint: string, body?: Record<string, unknown>,
): Promise<unknown> {
  const isAbsolute = endpoint.startsWith("http");
  const url = isAbsolute ? endpoint : `${BASE_URL}/rest${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202504",
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 201) {
    return { urn: res.headers.get("x-restli-id") };
  }
  if (!res.ok) throw new Error(`LinkedIn API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

// LinkedIn "little text" format escaping
function escapeText(text: string): string {
  return text.replace(/[(*)\[\]{}<>@|~_]/g, (char) => "\\" + char);
}

export default function linkedin(rl: RunlinePluginAPI) {
  rl.setName("linkedin");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "LinkedIn OAuth2 access token", env: "LINKEDIN_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("post.create", {
    description: "Create a post on LinkedIn. Supports text-only, article shares, and text with commentary. Image uploads require binary data and are not supported in this plugin.",
    inputSchema: {
      postAs: { type: "string", required: true, description: "'person' or 'organization'" },
      personOrOrgId: { type: "string", required: true, description: "Person ID or Organization ID (without URN prefix)" },
      text: { type: "string", required: true, description: "Post text/commentary" },
      shareMediaCategory: { type: "string", required: false, description: "'NONE' (default, text only), 'ARTICLE' (link share)" },
      visibility: { type: "string", required: false, description: "PUBLIC (default) or CONNECTIONS. Only applies when posting as person." },
      articleUrl: { type: "string", required: false, description: "URL for article share (required when shareMediaCategory is ARTICLE)" },
      articleTitle: { type: "string", required: false },
      articleDescription: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const {
        postAs,
        personOrOrgId,
        text,
        shareMediaCategory = "NONE",
        visibility = "PUBLIC",
        articleUrl,
        articleTitle,
        articleDescription,
      } = input as Record<string, unknown>;

      const authorUrn = postAs === "person"
        ? `urn:li:person:${personOrOrgId}`
        : `urn:li:organization:${personOrOrgId}`;

      const escapedText = escapeText(text as string);

      const body: Record<string, unknown> = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        distribution: {
          feedDistribution: "MAIN_FEED",
          thirdPartyDistributionChannels: [],
        },
        visibility: postAs === "person" ? (visibility as string) : "PUBLIC",
      };

      if (shareMediaCategory === "ARTICLE" && articleUrl) {
        const article: Record<string, unknown> = { source: articleUrl };
        if (articleTitle) article.title = articleTitle;
        if (articleDescription) article.description = articleDescription;
        body.content = { article };
        body.commentary = escapedText;
      } else {
        body.commentary = escapedText;
      }

      return apiRequest(tok(ctx), "POST", "/posts", body);
    },
  });
}
