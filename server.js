import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Optional default context stored in Railway.
 *
 * You can later create:
 * FLEARNING_POSITIONING=...
 *
 * The context entered on the UI takes priority.
 */
const DEFAULT_FLEARNING_POSITIONING =
  process.env.FLEARNING_POSITIONING || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  express.json({
    limit: "256kb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,

    message:
      "F.Learning Research API is running",

    services: {
      apify: Boolean(APIFY_TOKEN),
      openai: Boolean(OPENAI_API_KEY)
    },

    configuration: {
      defaultCompanyContext:
        Boolean(
          DEFAULT_FLEARNING_POSITIONING
        )
    }
  });
});

/**
 * Keyword-only overview.
 *
 * OpenAI receives only the keyword.
 * It receives no competitor content.
 */
app.post(
  "/api/overview",
  async (req, res) => {
    try {
      const keyword =
        cleanKeyword(
          req.body?.keyword
        );

      if (!keyword) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Keyword is required",
            data: null
          });
      }

      console.log(
        "Starting keyword overview:",
        keyword
      );

      const overview =
        await generateKeywordOverview(
          keyword
        );

      console.log(
        "Keyword overview completed:",
        keyword
      );

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

      return res
        .status(500)
        .json({
          success: false,

          error:
            error?.message ||
            "AI Overview failed",

          data: null
        });
    }
  }
);

/**
 * Full competitor research.
 *
 * Process:
 *
 * 1. Search and crawl through Apify.
 * 2. Filter blocked and duplicate URLs.
 * 3. Keep the 10 highest-ranking pages.
 * 4. Send their Markdown to OpenAI.
 * 5. Return articles plus three research sections.
 */
app.post(
  "/api/competitor-research",
  async (req, res) => {
    try {
      const keyword =
        cleanKeyword(
          req.body?.keyword
        );

      const suppliedCompanyContext =
        cleanCompanyContext(
          req.body?.companyContext
        );

      const companyContext =
        suppliedCompanyContext ||
        DEFAULT_FLEARNING_POSITIONING;

      if (!keyword) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Keyword is required",

            articles: [],

            research: null
          });
      }

      console.log(
        "Starting competitor research:",
        keyword
      );

      const articles =
        await searchArticlesWithApify(
          keyword
        );

      if (!articles.length) {
        return res.json({
          success: true,
          keyword,
          articles: [],
          research: null,

          warning:
            "No eligible competitor articles were found."
        });
      }

      console.log(
        "Eligible articles:",
        articles.length
      );

      const research =
        await generateCompetitorResearch({
          keyword,
          articles,
          companyContext
        });

      console.log(
        "Competitor analysis completed:",
        keyword
      );

      return res.json({
        success: true,
        keyword,
        articles,
        research,

        companyContextProvided:
          Boolean(companyContext)
      });
    } catch (error) {
      console.error(
        "Competitor research route error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          error:
            error?.message ||
            "Competitor research failed",

          articles: [],
          research: null
        });
    }
  }
);

/**
 * Optional article-only route.
 */
app.post(
  "/api/search",
  async (req, res) => {
    try {
      const keyword =
        cleanKeyword(
          req.body?.keyword
        );

      if (!keyword) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Keyword is required",
            results: []
          });
      }

      const results =
        await searchArticlesWithApify(
          keyword
        );

      return res.json({
        success: true,
        keyword,
        count: results.length,
        results
      });
    } catch (error) {
      console.error(
        "Search route error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          error:
            error?.message ||
            "Article search failed",

          results: []
        });
    }
  }
);

/**
 * Search and crawl pages through
 * Apify RAG Web Browser.
 */
async function searchArticlesWithApify(
  keyword
) {
  if (!APIFY_TOKEN) {
    throw new Error(
      "APIFY_TOKEN has not been configured in Railway"
    );
  }

  const endpoint =
    "https://api.apify.com/v2/actors/" +
    "apify~rag-web-browser/" +
    "run-sync-get-dataset-items";

  const actorInput = {
    debugMode: false,

    desiredConcurrency: 5,

    htmlTransformer: "none",

    /**
     * Request more than 10 because
     * some results will be removed.
     */
    maxResults: 20,

    outputFormats: [
      "markdown"
    ],

    proxyConfiguration: {
      useApifyProxy: true
    },

    query: keyword,

    removeCookieWarnings: true,

    removeElementsCssSelector:
      "nav, footer, script, style, " +
      "noscript, svg, " +
      "img[src^='data:'], " +
      '[role="alert"], ' +
      '[role="banner"], ' +
      '[role="dialog"], ' +
      '[role="alertdialog"], ' +
      '[role="region"]' +
      '[aria-label*="skip" i], ' +
      '[aria-modal="true"]',

    requestTimeoutSecs: 40,

    scrapingTool: "raw-http"
  };

  console.log(
    "Apify keyword:",
    keyword
  );

  console.log(
    "Apify input:",
    actorInput
  );

  const response =
    await fetch(endpoint, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${APIFY_TOKEN}`
      },

      body:
        JSON.stringify(
          actorInput
        ),

      signal:
        AbortSignal.timeout(
          240000
        )
    });

  const responseText =
    await response.text();

  console.log(
    "Apify status:",
    response.status
  );

  if (!response.ok) {
    console.error(
      "Apify error:",
      responseText.slice(
        0,
        3000
      )
    );

    throw new Error(
      `Apify failed with status ${response.status}`
    );
  }

  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      "Apify returned invalid JSON"
    );
  }

  const rawItems =
    Array.isArray(data)
      ? data
      : [data];

  const normalizedItems =
    rawItems
      .map(
        (
          item,
          index
        ) => {
          return normalizeRagResult(
            item,
            index
          );
        }
      )
      .filter(
        (item) =>
          item.url
      );

  /**
   * Processing order:
   *
   * 1. Remove blocked URLs.
   * 2. Remove duplicate URLs.
   * 3. Sort by original rank.
   * 4. Keep highest-ranking 10.
   * 5. Add stable article IDs.
   */
  return removeDuplicateUrls(
    normalizedItems.filter(
      (item) =>
        !isBlockedUrl(
          item.url
        )
    )
  )
    .sort(
      (a, b) =>
        a.originalPosition -
        b.originalPosition
    )
    .slice(0, 10)
    .map(
      (
        item,
        index
      ) => ({
        ...item,

        articleId:
          `article_${index + 1}`,

        position:
          index + 1
      })
    );
}

/**
 * Keyword-only:
 *
 * AI Overview
 * WHO
 * WHAT
 * WHY
 */
async function generateKeywordOverview(
  keyword
) {
  ensureOpenAIKey();

  const schema = {
    type: "object",

    additionalProperties:
      false,

    properties: {
      overview: {
        type: "object",

        additionalProperties:
          false,

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

        additionalProperties:
          false,

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

        additionalProperties:
          false,

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

        additionalProperties:
          false,

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
  };

  const instructions = `
You are a senior search-intent strategist for F.Learning Studio.

Analyse only the keyword supplied by the user.

Do not browse the web.
Do not use competitor content.
Do not invent statistics, studies or external evidence.

Return exactly four sections:

1. overview
2. who
3. what
4. why

OVERVIEW:
Give a direct explanation of the topic represented by the keyword.

WHO:
Identify the people most likely to search for the keyword.

WHAT:
Explain what they are likely trying to find, compare, understand or accomplish.

WHY:
Explain the underlying motivation, problem, pressure, risk or desired outcome.

Keep WHO, WHAT and WHY clearly separate.
Write in clear professional English.
`;

  return callOpenAIStructured({
    name:
      "keyword_search_intent",

    description:
      "Keyword-only overview and WHO, WHAT, WHY analysis.",

    schema,

    instructions,

    input: {
      keyword
    },

    maxOutputTokens: 2200
  });
}

/**
 * Markdown-based competitor research.
 */
async function generateCompetitorResearch({
  keyword,
  articles,
  companyContext
}) {
  ensureOpenAIKey();

  const preparedArticles =
    articles.map(
      (article) => ({
        articleId:
          article.articleId,

        position:
          article.position,

        originalPosition:
          article.originalPosition,

        title:
          article.title,

        url:
          article.url,

        domain:
          article.domain,

        contentStatus:
          article.markdown
            ? "available"
            : "missing",

        markdown:
          prepareMarkdownForAI(
            article.markdown
          )
      })
    );

  const schema =
    createCompetitorResearchSchema();

  const instructions = `
You are conducting evidence-based competitor content research for F.Learning Studio.

You receive:

1. A keyword.
2. Up to ten competitor articles.
3. The extracted Markdown of each article.
4. Optional company positioning and past content examples.

Return exactly three sections:

1. competitorMap
2. exclusiveAngles
3. openQuestions

GENERAL EVIDENCE RULES:

- Analyse each article separately.
- Tie every strength and weakness to one specific articleId.
- Do not transfer evidence from one article to another.
- Do not infer that an article omitted something if its Markdown appears incomplete.
- Evidence must describe something visibly present or absent in the supplied Markdown.
- Do not invent statistics, article sections, examples or company capabilities.
- When evidence is insufficient, say so.
- Every uncertainty must become an open question.
- Do not treat a claim as verified merely because an article states it.

COMPETITOR MAP:

For every supplied article, return one map entry.

Strengths should identify what the article does well enough that the new article should match or exceed it.

Weaknesses should identify:
- missing coverage,
- shallow explanations,
- unsupported claims,
- unclear reasoning,
- weak examples,
- missing decision support,
- misleading framing,
- or content that appears incorrect based only on the supplied text.

Every point must include a concise evidence note from that article.

TEAM EXCLUSIVE ANGLES:

Use both:
- gaps visible in the competitor content;
- supplied company positioning or past content context.

Only call an angle "owned" when the company context gives credible evidence that F.Learning can support it.

When company evidence is missing, classify the angle as "potential".

All exclusive angles together should be capable of carrying approximately 30–40% of the eventual article.

Do not suggest generic angles that any competitor could easily claim.

OPEN QUESTIONS:

Every missing, uncertain, conflicting or unverifiable point must be converted into a plain question.

Each question must include:
- why it exists;
- the articleIds that triggered it;
- the type of source needed to answer it.

Do not answer these questions.
Do not paper over uncertainty.
`;

  const input = {
    keyword,

    companyContext:
      companyContext ||
      "No verified company positioning or past content examples were supplied. Treat all exclusive angles as potential and list the internal evidence required before ownership can be claimed.",

    articles:
      preparedArticles
  };

  return callOpenAIStructured({
    name:
      "competitor_research",

    description:
      "Article-specific competitor map, team angles and open questions.",

    schema,

    instructions,

    input,

    maxOutputTokens: 12000
  });
}

function createCompetitorResearchSchema() {
  return {
    type: "object",

    additionalProperties:
      false,

    properties: {
      competitorMap: {
        type: "array",

        minItems: 1,
        maxItems: 10,

        items: {
          type: "object",

          additionalProperties:
            false,

          properties: {
            articleId: {
              type: "string"
            },

            title: {
              type: "string"
            },

            url: {
              type: "string"
            },

            analysisStatus: {
              type: "string",

              enum: [
                "complete",
                "partial",
                "insufficient_content"
              ]
            },

            strengths: {
              type: "array",

              maxItems: 5,

              items: {
                type: "object",

                additionalProperties:
                  false,

                properties: {
                  point: {
                    type: "string"
                  },

                  evidence: {
                    type: "string"
                  },

                  mustMatch: {
                    type: "boolean"
                  }
                },

                required: [
                  "point",
                  "evidence",
                  "mustMatch"
                ]
              }
            },

            weaknesses: {
              type: "array",

              maxItems: 5,

              items: {
                type: "object",

                additionalProperties:
                  false,

                properties: {
                  point: {
                    type: "string"
                  },

                  evidence: {
                    type: "string"
                  },

                  opportunity: {
                    type: "string"
                  }
                },

                required: [
                  "point",
                  "evidence",
                  "opportunity"
                ]
              }
            },

            analysisNote: {
              type: "string"
            }
          },

          required: [
            "articleId",
            "title",
            "url",
            "analysisStatus",
            "strengths",
            "weaknesses",
            "analysisNote"
          ]
        }
      },

      exclusiveAngles: {
        type: "array",

        maxItems: 8,

        items: {
          type: "object",

          additionalProperties:
            false,

          properties: {
            angle: {
              type: "string"
            },

            ownershipStatus: {
              type: "string",

              enum: [
                "owned",
                "potential"
              ]
            },

            whyItMatters: {
              type: "string"
            },

            competitorGap: {
              type: "string"
            },

            whyTeamCanOwnIt: {
              type: "string"
            },

            supportingArticleIds: {
              type: "array",

              items: {
                type: "string"
              }
            },

            requiredInternalEvidence: {
              type: "array",

              items: {
                type: "string"
              }
            },

            recommendedArticleSharePercent: {
              type: "integer",

              minimum: 5,
              maximum: 40
            }
          },

          required: [
            "angle",
            "ownershipStatus",
            "whyItMatters",
            "competitorGap",
            "whyTeamCanOwnIt",
            "supportingArticleIds",
            "requiredInternalEvidence",
            "recommendedArticleSharePercent"
          ]
        }
      },

      openQuestions: {
        type: "array",

        maxItems: 20,

        items: {
          type: "object",

          additionalProperties:
            false,

          properties: {
            question: {
              type: "string"
            },

            reason: {
              type: "string"
            },

            triggeredByArticleIds: {
              type: "array",

              items: {
                type: "string"
              }
            },

            requiredSourceType: {
              type: "string"
            },

            priority: {
              type: "string",

              enum: [
                "high",
                "medium",
                "low"
              ]
            },

            status: {
              type: "string",

              enum: [
                "unanswered"
              ]
            }
          },

          required: [
            "question",
            "reason",
            "triggeredByArticleIds",
            "requiredSourceType",
            "priority",
            "status"
          ]
        }
      }
    },

    required: [
      "competitorMap",
      "exclusiveAngles",
      "openQuestions"
    ]
  };
}

/**
 * Shared OpenAI Responses API helper.
 */
async function callOpenAIStructured({
  name,
  description,
  schema,
  instructions,
  input,
  maxOutputTokens
}) {
  ensureOpenAIKey();

  const endpoint =
    "https://api.openai.com/v1/responses";

  const requestBody = {
    model:
      "gpt-5-mini",

    store: false,

    max_output_tokens:
      maxOutputTokens,

    instructions,

    input:
      JSON.stringify(input),

    text: {
      format: {
        type:
          "json_schema",

        name,

        description,

        strict: true,

        schema
      }
    }
  };

  console.log(
    "OpenAI task:",
    name
  );

  const response =
    await fetch(endpoint, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${OPENAI_API_KEY}`
      },

      body:
        JSON.stringify(
          requestBody
        ),

      signal:
        AbortSignal.timeout(
          240000
        )
    });

  const responseText =
    await response.text();

  console.log(
    `OpenAI ${name} status:`,
    response.status
  );

  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      "OpenAI returned invalid JSON"
    );
  }

  if (!response.ok) {
    console.error(
      `OpenAI ${name} error:`,
      responseText.slice(
        0,
        4000
      )
    );

    throw new Error(
      data?.error?.message ||
      `OpenAI request failed with status ${response.status}`
    );
  }

  if (
    data?.status ===
    "incomplete"
  ) {
    throw new Error(
      data
        ?.incomplete_details
        ?.reason ||
      "OpenAI response was incomplete"
    );
  }

  if (
    data?.status ===
    "failed"
  ) {
    throw new Error(
      data?.error?.message ||
      "OpenAI response failed"
    );
  }

  const outputText =
    extractOpenAIOutputText(
      data
    );

  if (!outputText) {
    throw new Error(
      "OpenAI returned no output text"
    );
  }

  try {
    return JSON.parse(
      outputText
    );
  } catch {
    console.error(
      "Invalid OpenAI structured output:",
      outputText.slice(
        0,
        5000
      )
    );

    throw new Error(
      "OpenAI output was not valid structured JSON"
    );
  }
}

function extractOpenAIOutputText(
  response
) {
  if (
    typeof
      response?.output_text ===
      "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  if (
    !Array.isArray(
      response?.output
    )
  ) {
    return "";
  }

  for (
    const outputItem
    of response.output
  ) {
    if (
      !Array.isArray(
        outputItem?.content
      )
    ) {
      continue;
    }

    for (
      const contentItem
      of outputItem.content
    ) {
      if (
        contentItem?.type ===
          "output_text" &&
        typeof
          contentItem?.text ===
          "string"
      ) {
        return contentItem.text.trim();
      }

      if (
        contentItem?.type ===
          "refusal" &&
        typeof
          contentItem?.refusal ===
          "string"
      ) {
        throw new Error(
          `OpenAI refused the request: ${contentItem.refusal}`
        );
      }
    }
  }

  return "";
}

function prepareMarkdownForAI(
  markdown
) {
  if (!markdown) {
    return "";
  }

  const cleaned =
    String(markdown)
      .replace(
        /\n{4,}/g,
        "\n\n\n"
      )
      .trim();

  /**
   * Keep cost and request size controlled.
   */
  return cleaned.slice(
    0,
    14000
  );
}

function normalizeRagResult(
  item,
  index
) {
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

  const originalPosition =
    Number(
      item?.position ||
      item?.rank ||
      item?.searchPosition ||
      item?.search_position ||
      item?.metadata
        ?.position ||
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
    item?.metadata
      ?.description ||
    createSnippet(markdown);

  return {
    position:
      originalPosition,

    originalPosition,

    title,

    url,

    description,

    domain:
      getDomain(url),

    markdown
  };
}

function removeDuplicateUrls(
  items
) {
  const seen = new Set();

  return items.filter(
    (item) => {
      const normalized =
        normalizeUrlForComparison(
          item.url
        );

      if (
        !normalized ||
        seen.has(normalized)
      ) {
        return false;
      }

      seen.add(normalized);

      return true;
    }
  );
}

function normalizeUrlForComparison(
  url
) {
  try {
    const parsed =
      new URL(url);

    parsed.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid"
    ].forEach(
      (parameter) => {
        parsed.searchParams
          .delete(
            parameter
          );
      }
    );

    if (
      parsed.pathname.length >
        1 &&
      parsed.pathname.endsWith(
        "/"
      )
    ) {
      parsed.pathname =
        parsed.pathname.slice(
          0,
          -1
        );
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function isBlockedUrl(url) {
  try {
    const hostname =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

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

    return blockedDomains.some(
      (domain) =>
        hostname === domain ||
        hostname.endsWith(
          `.${domain}`
        )
    );
  } catch {
    return true;
  }
}

function createSnippet(
  markdown
) {
  if (!markdown) {
    return "";
  }

  return String(markdown)
    .replace(
      /```[\s\S]*?```/g,
      " "
    )
    .replace(
      /!\[[^\]]*\]\([^)]*\)/g,
      " "
    )
    .replace(
      /\[([^\]]+)\]\([^)]*\)/g,
      "$1"
    )
    .replace(
      /[#>*_`~-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      280
    );
}

function getDomain(url) {
  try {
    return new URL(url)
      .hostname
      .replace(
        /^www\./,
        ""
      );
  } catch {
    return "";
  }
}

function cleanKeyword(value) {
  return String(value || "")
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      250
    );
}

function cleanCompanyContext(value) {
  return String(value || "")
    .replace(
      /\r/g,
      ""
    )
    .trim()
    .slice(
      0,
      20000
    );
}

function ensureOpenAIKey() {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY has not been configured in Railway"
    );
  }
}

/**
 * Frontend fallback.
 */
app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);
