import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialOk } from "../../_shared/credentials.js";
import { linkedinCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialOk(ctx, linkedinCredential, "linkedin", {
    target: "api",
    path,
    method,
    headers: {
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202504",
    },
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
  if (res.status === 201) {
    return { urn: res.headers.get("x-restli-id") };
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

// LinkedIn "little text" format escaping
function escapeText(text: string): string {
  return text.replace(/[(*)[\]{}<>@|~_]/g, (char) => "\\" + char);
}

export default function linkedin(rl: RunlinePluginAPI) {
  rl.setName("linkedin");
  rl.setVersion("0.1.0");
  rl.setCredential(linkedinCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "LinkedIn OAuth2 access token",
      env: "LINKEDIN_ACCESS_TOKEN",
    },
  });

  rl.registerAction("post.create", {
    access: "write",
    description:
      "Create a post on LinkedIn. Supports text-only, article shares, and text with commentary. Image uploads require binary data and are not supported in this plugin.",
    inputSchema: {
      postAs: {
        type: "string",
        required: true,
        description: "'person' or 'organization'",
      },
      personOrOrgId: {
        type: "string",
        required: true,
        description: "Person ID or Organization ID (without URN prefix)",
      },
      text: {
        type: "string",
        required: true,
        description: "Post text/commentary",
      },
      shareMediaCategory: {
        type: "string",
        required: false,
        description: "'NONE' (default, text only), 'ARTICLE' (link share)",
      },
      visibility: {
        type: "string",
        required: false,
        description:
          "PUBLIC (default) or CONNECTIONS. Only applies when posting as person.",
      },
      articleUrl: {
        type: "string",
        required: false,
        description:
          "URL for article share (required when shareMediaCategory is ARTICLE)",
      },
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

      const authorUrn =
        postAs === "person"
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

      return apiRequest(ctx, "POST", "posts", body);
    },
  });
}
