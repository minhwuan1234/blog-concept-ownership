import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "F.Learning Research API is running"
  });
});

/**
 * Google search through Apify
 */
app.post("/api/search", async (req, res) => {
  try {
    const keyword = String(req.body?.keyword || "").trim();

    const languageCode = String(
      req.body?.languageCode || "en"
    )
      .trim()
      .toLowerCase();

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required",
        results: []
      });
    }

    if (!APIFY_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "APIFY_TOKEN has not been configured in Railway",
        results: []
      });
    }

    /**
     * New official Apify Actor endpoint
     *
     * Do not put the token directly in this URL.
     * The token is sent through the Authorization header below.
     */
    const apifyEndpoint =
      "https://api.apify.com/v2/actors/" +
      "apify~google-search-scraper/" +
      "run-sync-get-dataset-items";

    /**
     * New Actor input
     *
     * The keyword entered in the UI replaces the value of queries.
     */
    const actorInput = {
      aiOverview: {
        scrapeFullAiOverview: false
      },

      chatGptSearch: {
        enableChatGpt: false
      },

      copilotSearch: {
        enableCopilot: false
      },

      focusOnPaidAds: false,
      forceExactMatch: false,

      geminiSearch: {
        enableGemini: true
      },

      includeIcons: false,
      includeUnfilteredResults: false,

      /**
       * We only need the first Google page for the top 10 competitors.
       * Setting this to 10 would scrape up to 10 pages and cost more.
       */
      maxPagesPerQuery: 1,

      maximumLeadsEnrichmentRecords: 0,
      mobileResults: false,

      perplexitySearch: {
        enablePerplexity: false,
        returnImages: false,
        returnRelatedQuestions: false
      },

      /**
       * Dynamic keyword from the UI.
       *
       * Example:
       * User enters "learning & development"
       * queries becomes "learning & development"
       */
      queries: keyword,

      saveHtml: false,
      saveHtmlToKeyValueStore: true,

      searchLanguage: languageCode,

      verifyLeadsEnrichmentEmails: false
    };

    console.log("Searching keyword:", keyword);
    console.log("Apify endpoint:", apifyEndpoint);
    console.log("Apify input:", actorInput);

    const apifyResponse = await fetch(apifyEndpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APIFY_TOKEN}`
      },

      body: JSON.stringify(actorInput),

      signal: AbortSignal.timeout(180000)
    });

    const responseText = await apifyResponse.text();

    console.log("Apify status:", apifyResponse.status);
    console.log(
      "Apify raw response:",
      responseText.slice(0, 5000)
    );

    if (!apifyResponse.ok) {
      return res.status(502).json({
        success: false,
        error: "Apify search failed",
        details: responseText.slice(0, 1500),
        results: []
      });
    }

    let apifyData;

    try {
      apifyData = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Apify returned invalid JSON",
        results: []
      });
    }

    /**
     * Official Google Search Scraper normally returns an array.
     * Each item represents one Google results page.
     *
     * Organic results are commonly inside:
     * page.organicResults
     */
    const pages = Array.isArray(apifyData)
      ? apifyData
      : [apifyData];

    const rawOrganicResults = pages.flatMap((page) => {
      if (Array.isArray(page?.organicResults)) {
        return page.organicResults;
      }

      if (Array.isArray(page?.organic_results)) {
        return page.organic_results;
      }

      return [];
    });

    const results = normalizeResults(rawOrganicResults).slice(0, 10);

    /**
     * Keep additional data for later research stages.
     */
    const aiOverviews = pages
      .map((page) => {
        return (
          page?.aiOverview ||
          page?.ai_overview ||
          null
        );
      })
      .filter(Boolean);

    const peopleAlsoAsk = pages.flatMap((page) => {
      if (Array.isArray(page?.peopleAlsoAsk)) {
        return page.peopleAlsoAsk;
      }

      if (Array.isArray(page?.people_also_ask)) {
        return page.people_also_ask;
      }

      return [];
    });

    return res.json({
      success: true,

      keyword,

      count: results.length,

      results,

      aiOverview: aiOverviews[0] || null,

      peopleAlsoAsk,

      debug: {
        pageCount: pages.length,
        rawOrganicCount: rawOrganicResults.length,
        hasAiOverview: aiOverviews.length > 0,
        peopleAlsoAskCount: peopleAlsoAsk.length
      }
    });
  } catch (error) {
    console.error("Search route error:", error);

    const isTimeout =
      error?.name === "TimeoutError" ||
      error?.name === "AbortError";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,

      error: isTimeout
        ? "Apify search timed out"
        : error?.message || "Unexpected server error",

      results: []
    });
  }
});

/**
 * Convert Apify organic results into the structure expected by app.js.
 */
function normalizeResults(items) {
  const seenUrls = new Set();

  return items
    .map((item, index) => {
      const url =
        item?.url ||
        item?.link ||
        "";

      return {
        position: Number(
          item?.position ||
          item?.rank ||
          index + 1
        ),

        title:
          item?.title ||
          item?.headline ||
          "Untitled article",

        url,

        description:
          item?.description ||
          item?.snippet ||
          item?.text ||
          "",

        domain: getDomain(url)
      };
    })
    .filter((item) => {
      if (!item.url) {
        return false;
      }

      if (seenUrls.has(item.url)) {
        return false;
      }

      seenUrls.add(item.url);

      return true;
    })
    .sort((a, b) => a.position - b.position);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Frontend fallback
 */
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
