import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "F.Learning Research API is running",
    services: {
      apify: Boolean(APIFY_TOKEN),
      openai: Boolean(OPENAI_API_KEY)
    }
  });
});

/**
 * Main research endpoint.
 *
 * Apify and OpenAI run in parallel.
 * OpenAI only receives the keyword.
 */
app.post("/api/research", async (req, res) => {
  try {
    const keyword = cleanKeyword(req.body?.keyword);

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required"
      });
    }

    const [articlesTask, overviewTask] =
      await Promise.allSettled([
        searchArticlesWithApify(keyword),
        generateKeywordOverview(keyword)
      ]);

    const articles =
      articlesTask.status === "fulfilled"
        ? {
            success: true,
            count: articlesTask.value.length,
            results: articlesTask.value
          }
        : {
            success: false,
            count: 0,
            results: [],
            error:
              articlesTask.reason?.message ||
              "Article search failed"
          };

    const overview =
      overviewTask.status === "fulfilled"
        ? {
            success: true,
            data: overviewTask.value
          }
        : {
            success: false,
            data: null,
            error:
              overviewTask.reason?.message ||
              "AI Overview failed"
          };

    return res.json({
      success: articles.success || overview.success,
      keyword,
      articles,
      overview
    });
  } catch (error) {
    console.error("Research route error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unexpected server error"
    });
  }
});

/**
 * Legacy article-only endpoint.
 */
app.post("/api/search", async (req, res) => {
  try {
    const keyword = cleanKeyword(req.body?.keyword);

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required",
        results: []
      });
    }

    const results =
      await searchArticlesWithApify(keyword);

    return res.json({
      success: true,
      keyword,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("Search route error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Article search failed",
      results: []
    });
  }
});

/**
 * Search and crawl pages through Apify RAG Web Browser.
 */
async function searchArticlesWithApify(keyword) {
  if (!APIFY_TOKEN) {
    throw new Error(
      "APIFY_TOKEN has not been configured in Railway"
    );
  }

  const apifyEndpoint =
    "https://api.apify.com/v2/actors/" +
    "apify~rag-web-browser/" +
    "run-sync-get-dataset-items";

  const actorInput = {
    debugMode: false,
    desiredConcurrency: 5,
    htmlTransformer: "none",

    /**
     * Request more than 10 because blocked URLs
     * and duplicate results will be removed.
     */
    maxResults: 3,

    outputFormats: [
      "markdown"
    ],

    proxyConfiguration: {
      useApifyProxy: true
    },

    query: keyword,

    removeCookieWarnings: true,

    removeElementsCssSelector:
      "nav, footer, script, style, noscript, svg, " +
      "img[src^='data:'], " +
      '[role="alert"], ' +
      '[role="banner"], ' +
      '[role="dialog"], ' +
      '[role="alertdialog"], ' +
      '[role="region"][aria-label*="skip" i], ' +
      '[aria-modal="true"]',

    requestTimeoutSecs: 40,
    scrapingTool: "raw-http"
  };

  console.log("Apify keyword:", keyword);
  console.log("Apify input:", actorInput);

  const response = await fetch(apifyEndpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`
    },

    body: JSON.stringify(actorInput),

    signal: AbortSignal.timeout(240000)
  });

  const responseText = await response.text();

  console.log("Apify status:", response.status);
  console.log(
    "Apify raw response:",
    responseText.slice(0, 5000)
  );

  if (!response.ok) {
    console.error(
      "Apify error:",
      responseText.slice(0, 2000)
    );

    throw new Error(
      `Apify search failed with status ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Apify returned invalid JSON"
    );
  }

  const rawItems = Array.isArray(data)
    ? data
    : [data];

  const normalizedItems = rawItems
    .map((item, index) => {
      return normalizeRagResult(item, index);
    })
    .filter((item) => item.url);

  /**
   * Final processing order:
   *
   * 1. Remove social media and Wikipedia.
   * 2. Remove duplicate URLs.
   * 3. Sort by original search rank.
   * 4. Select the 10 highest-ranking eligible pages.
   * 5. Re-number display position from 1 to 10.
   */
  const filteredItems = removeDuplicateUrls(
    normalizedItems.filter((item) => {
      return !isBlockedUrl(item.url);
    })
  )
    .sort((a, b) => {
      return a.originalPosition - b.originalPosition;
    })
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      position: index + 1
    }));

  return filteredItems;
}

/**
 * Generate AI Overview + WHO + WHAT + WHY.
 *
 * This function only receives the keyword.
 * It receives no Apify result, URL, title, snippet or article content.
 */
async function generateKeywordOverview(keyword) {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY has not been configured in Railway"
    );
  }

  const openAIEndpoint =
    "https://api.openai.com/v1/responses";

  const requestBody = {
    model: "gpt-5-mini",

    store: false,

    instructions: `
You are a senior search-intent strategist for F.Learning Studio.

Analyse only the keyword supplied by the user.

Do not use web search, competitor articles, external sources,
statistics, studies or assumed evidence.

Return exactly four sections in this exact order:

1. OVERVIEW
2. WHO
3. WHAT
4. WHY

OVERVIEW:
Provide a direct and concise AI answer explaining the topic represented
by the keyword. State what the topic generally means and the main idea
a searcher needs to understand first.

WHO:
Identify the most likely person or group searching for the keyword.
Describe their likely role, organisational context, level of knowledge,
decision-making responsibility and stage in the search journey.

WHAT:
Explain what the searcher is most likely trying to find, understand,
compare, evaluate, select or accomplish through the search.

WHY:
Explain the likely motivation or trigger behind the search, such as a
problem, business pressure, risk, desired outcome or upcoming decision.

Rules:

- Use only the supplied keyword.
- Do not claim that web research has been performed.
- Do not mention competitor articles or search results.
- Do not fabricate facts, numbers, statistics, studies or evidence.
- OVERVIEW explains the topic itself.
- WHO describes the searcher.
- WHAT describes what the searcher wants.
- WHY describes the motivation behind the search.
- Keep WHAT and WHY clearly separate.
- When the keyword is ambiguous, use the most likely interpretation and
  briefly acknowledge the ambiguity in OVERVIEW.
- Express uncertainty through the confidence fields.
- Write in clear professional English.
- Keep every section concise, useful and specific.
`,

    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Keyword: ${keyword}`
          }
        ]
      }
    ],

    text: {
      format: {
        type: "json_schema",
        name: "keyword_search_intent",
        description:
          "Keyword-only AI Overview and WHO, WHAT, WHY search-intent analysis.",
        strict: true,

        schema: {
          type: "object",
          additionalProperties: false,

          properties: {
            overview: {
              type: "object",
              additionalProperties: false,

              properties: {
                answer: {
                  type: "string"
                },

                keyPoints: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,

                  items: {
                    type: "string"
                  }
                },

                confidence: {
                  type: "string",
                  enum: [
                    "high",
                    "medium",
                    "low"
                  ]
                }
              },

              required: [
                "answer",
                "keyPoints",
                "confidence"
              ]
            },

            who: {
              type: "object",
              additionalProperties: false,

              properties: {
                summary: {
                  type: "string"
                },

                details: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,

                  items: {
                    type: "string"
                  }
                },

                confidence: {
                  type: "string",
                  enum: [
                    "high",
                    "medium",
                    "low"
                  ]
                }
              },

              required: [
                "summary",
                "details",
                "confidence"
              ]
            },

            what: {
              type: "object",
              additionalProperties: false,

              properties: {
                summary: {
                  type: "string"
                },

                details: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,

                  items: {
                    type: "string"
                  }
                },

                confidence: {
                  type: "string",
                  enum: [
                    "high",
                    "medium",
                    "low"
                  ]
                }
              },

              required: [
                "summary",
                "details",
                "confidence"
              ]
            },

            why: {
              type: "object",
              additionalProperties: false,

              properties: {
                summary: {
                  type: "string"
                },

                details: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,

                  items: {
                    type: "string"
                  }
                },

                confidence: {
                  type: "string",
                  enum: [
                    "high",
                    "medium",
                    "low"
                  ]
                }
              },

              required: [
                "summary",
                "details",
                "confidence"
              ]
            }
          },

          required: [
            "overview",
            "who",
            "what",
            "why"
          ]
        }
      }
    }
  };

  console.log("OpenAI keyword:", keyword);

  const response = await fetch(openAIEndpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },

    body: JSON.stringify(requestBody),

    signal: AbortSignal.timeout(120000)
  });

  const responseText = await response.text();

  console.log("OpenAI status:", response.status);
  console.log(
    "OpenAI raw response:",
    responseText.slice(0, 5000)
  );

  if (!response.ok) {
    console.error(
      "OpenAI error:",
      responseText.slice(0, 2000)
    );

    let openAIErrorMessage =
      `OpenAI request failed with status ${response.status}`;

    try {
      const errorData =
        JSON.parse(responseText);

      if (errorData?.error?.message) {
        openAIErrorMessage =
          errorData.error.message;
      }
    } catch {
      // Keep fallback error message.
    }

    throw new Error(openAIErrorMessage);
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      "OpenAI returned invalid JSON"
    );
  }

  if (data?.status === "incomplete") {
    throw new Error(
      data?.incomplete_details?.reason ||
      "OpenAI response was incomplete"
    );
  }

  if (data?.status === "failed") {
    throw new Error(
      data?.error?.message ||
      "OpenAI response failed"
    );
  }

  const outputText =
    extractOpenAIOutputText(data);

  if (!outputText) {
    throw new Error(
      "OpenAI returned no overview content"
    );
  }

  try {
    return JSON.parse(outputText);
  } catch {
    console.error(
      "Unparseable OpenAI output:",
      outputText
    );

    throw new Error(
      "OpenAI overview was not valid structured JSON"
    );
  }
}

/**
 * Extract text generated by the Responses API.
 */
function extractOpenAIOutputText(response) {
  if (
    typeof response?.output_text === "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response?.output)) {
    return "";
  }

  for (const outputItem of response.output) {
    if (!Array.isArray(outputItem?.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (
        contentItem?.type === "output_text" &&
        typeof contentItem?.text === "string"
      ) {
        return contentItem.text.trim();
      }

      if (
        contentItem?.type === "refusal" &&
        typeof contentItem?.refusal === "string"
      ) {
        throw new Error(
          `OpenAI refused the request: ${contentItem.refusal}`
        );
      }
    }
  }

  return "";
}

/**
 * Normalize one Apify RAG Web Browser result.
 */
function normalizeRagResult(item, index) {
  const url =
    item?.url ||
    item?.pageUrl ||
    item?.page_url ||
    item?.loadedUrl ||
    item?.loaded_url ||
    item?.requestUrl ||
    item?.request_url ||
    item?.metadata?.url ||
    "";

  const originalPosition = Number(
    item?.position ||
    item?.rank ||
    item?.searchPosition ||
    item?.search_position ||
    item?.metadata?.position ||
    index + 1
  );

  const title =
    item?.title ||
    item?.pageTitle ||
    item?.page_title ||
    item?.metadata?.title ||
    getDomain(url) ||
    "Untitled article";

  const markdown =
    item?.markdown ||
    item?.content ||
    item?.text ||
    "";

  const description =
    item?.description ||
    item?.snippet ||
    item?.metadata?.description ||
    createSnippet(markdown);

  return {
    position: originalPosition,
    originalPosition,
    title,
    url,
    description,
    domain: getDomain(url),
    markdown
  };
}

/**
 * Remove duplicate URLs.
 */
function removeDuplicateUrls(items) {
  const seen = new Set();

  return items.filter((item) => {
    const normalizedUrl =
      normalizeUrlForComparison(item.url);

    if (
      !normalizedUrl ||
      seen.has(normalizedUrl)
    ) {
      return false;
    }

    seen.add(normalizedUrl);
    return true;
  });
}

/**
 * Normalize URL before duplicate comparison.
 */
function normalizeUrlForComparison(url) {
  try {
    const parsedUrl = new URL(url);

    parsedUrl.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid"
    ].forEach((parameter) => {
      parsedUrl.searchParams.delete(parameter);
    });

    if (
      parsedUrl.pathname.length > 1 &&
      parsedUrl.pathname.endsWith("/")
    ) {
      parsedUrl.pathname =
        parsedUrl.pathname.slice(0, -1);
    }

    return parsedUrl.toString();
  } catch {
    return "";
  }
}

/**
 * Remove social media and Wikipedia-related URLs.
 */
function isBlockedUrl(url) {
  try {
    const hostname = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    const blockedDomains = [
      "facebook.com",
      "instagram.com",
      "linkedin.com",
      "twitter.com",
      "x.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "pinterest.com",
      "reddit.com",
      "threads.net",
      "snapchat.com",
      "quora.com",
      "wikipedia.org",
      "wikimedia.org",
      "wikidata.org"
    ];

    return blockedDomains.some((domain) => {
      return (
        hostname === domain ||
        hostname.endsWith(`.${domain}`)
      );
    });
  } catch {
    return true;
  }
}

/**
 * Create a short description from Markdown.
 */
function createSnippet(markdown) {
  if (!markdown) {
    return "";
  }

  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function getDomain(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);
}

/**
 * Serve frontend for all non-API routes.
 */
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
