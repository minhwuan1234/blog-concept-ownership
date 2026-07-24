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
/**
 * Keyword-only AI Overview endpoint.
 *
 * This endpoint is independent from Apify.
 */
app.post("/api/overview", async (req, res) => {
  try {
    const keyword = cleanKeyword(req.body?.keyword);

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required",
        data: null
      });
    }

    console.log("Starting OpenAI Overview:", keyword);

    const overview =
      await generateKeywordOverview(keyword);

    console.log("OpenAI Overview completed:", keyword);

    return res.json({
      success: true,
      keyword,
      data: overview
    });
  } catch (error) {
    console.error(
      "Overview route error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "AI Overview failed",
      data: null
    });
  }
});

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

  const schema = {
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
            items: {
              type: "string"
            }
          },

          confidence: {
            type: "string",
            enum: ["high", "medium", "low"]
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
            items: {
              type: "string"
            }
          },

          confidence: {
            type: "string",
            enum: ["high", "medium", "low"]
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
            items: {
              type: "string"
            }
          },

          confidence: {
            type: "string",
            enum: ["high", "medium", "low"]
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
            items: {
              type: "string"
            }
          },

          confidence: {
            type: "string",
            enum: ["high", "medium", "low"]
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
  };

  const requestBody = {
    /*
     * Use a broadly available model for the first working version.
     * We can change this back to gpt-5-mini after confirming the API flow.
     */
    model: "gpt-4.1-mini",

    store: false,

    max_output_tokens: 1600,

    instructions: `
You are a senior search-intent strategist for F.Learning Studio.

Analyse only the keyword supplied by the user.

Do not browse the web.
Do not use competitor articles.
Do not claim to have researched external sources.
Do not invent statistics, studies or factual evidence.

Return exactly four sections:

1. overview
2. who
3. what
4. why

OVERVIEW:
Give a direct explanation of the topic represented by the keyword.
Explain what it generally means and the central idea a searcher should
understand first.

WHO:
Identify the most likely person or group searching for the keyword.
Describe their likely role, context, knowledge level and decision-making
responsibility.

WHAT:
Explain what the searcher is likely trying to find, understand, compare,
evaluate, select or accomplish.

WHY:
Explain the likely motivation behind the search, such as a problem,
pressure, risk, desired outcome or upcoming decision.

Keep WHO, WHAT and WHY clearly separate.

For overview.keyPoints, return between 2 and 4 items.
For who.details, what.details and why.details, return between 2 and 4 items.

Write in clear professional English.
`,

    input: `Keyword: ${keyword}`,

    text: {
      format: {
        type: "json_schema",
        name: "keyword_search_intent",
        strict: true,
        schema
      }
    }
  };

  console.log("OpenAI keyword:", keyword);

  /*
   * Log whether the key exists, but never print the actual API key.
   */
  console.log(
    "OpenAI key configured:",
    Boolean(OPENAI_API_KEY)
  );

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

  /*
   * This is necessary while debugging.
   * It prints the response but never prints the API key.
   */
  console.log(
    "OpenAI raw response:",
    responseText.slice(0, 8000)
  );

  let responseData = null;

  try {
    responseData = JSON.parse(responseText);
  } catch {
    if (!response.ok) {
      throw new Error(
        `OpenAI request failed with status ${response.status}`
      );
    }

    throw new Error(
      "OpenAI returned a response that was not valid JSON"
    );
  }

  if (!response.ok) {
    const apiMessage =
      responseData?.error?.message ||
      responseData?.error?.code ||
      `OpenAI request failed with status ${response.status}`;

    throw new Error(apiMessage);
  }

  if (responseData?.status === "failed") {
    throw new Error(
      responseData?.error?.message ||
      "OpenAI response failed"
    );
  }

  if (responseData?.status === "incomplete") {
    throw new Error(
      responseData?.incomplete_details?.reason ||
      "OpenAI response was incomplete"
    );
  }

  const outputText =
    extractOpenAIOutputText(responseData);

  console.log(
    "Extracted OpenAI output:",
    outputText.slice(0, 5000)
  );

  if (!outputText) {
    throw new Error(
      "OpenAI completed the request but returned no output text"
    );
  }

  let overview;

  try {
    overview = JSON.parse(outputText);
  } catch {
    throw new Error(
      "OpenAI returned output text, but it was not valid JSON"
    );
  }

  validateOverviewResponse(overview);

  return overview;
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

function validateOverviewResponse(data) {
  if (!data || typeof data !== "object") {
    throw new Error(
      "OpenAI overview has an invalid root structure"
    );
  }

  const requiredSections = [
    "overview",
    "who",
    "what",
    "why"
  ];

  for (const section of requiredSections) {
    if (
      !data[section] ||
      typeof data[section] !== "object"
    ) {
      throw new Error(
        `OpenAI overview is missing section: ${section}`
      );
    }
  }

  if (
    typeof data.overview.answer !== "string" ||
    !Array.isArray(data.overview.keyPoints) ||
    typeof data.overview.confidence !== "string"
  ) {
    throw new Error(
      "OpenAI overview section has an invalid structure"
    );
  }

  for (const section of ["who", "what", "why"]) {
    if (
      typeof data[section].summary !== "string" ||
      !Array.isArray(data[section].details) ||
      typeof data[section].confidence !== "string"
    ) {
      throw new Error(
        `OpenAI ${section} section has an invalid structure`
      );
    }
  }
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
