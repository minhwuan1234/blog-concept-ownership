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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "F.Learning Research API is running"
  });
});

app.post("/api/search", async (req, res) => {
  try {
    const keyword = String(req.body?.keyword || "").trim();

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

    const apifyEndpoint =
      "https://api.apify.com/v2/actors/" +
      "apify~rag-web-browser/" +
      "run-sync-get-dataset-items";

    const actorInput = {
      debugMode: false,
      desiredConcurrency: 5,
      htmlTransformer: "none",
      maxResults: 20,

      outputFormats: [
        "markdown"
      ],

      proxyConfiguration: {
        useApifyProxy: true
      },

      // Keyword động lấy từ ô input trên UI
      query: keyword,

      removeCookieWarnings: true,

      removeElementsCssSelector:
        "nav, footer, script, style, noscript, svg, img[src^='data:'],\n" +
        '[role="alert"],\n' +
        '[role="banner"],\n' +
        '[role="dialog"],\n' +
        '[role="alertdialog"],\n' +
        '[role="region"][aria-label*="skip" i],\n' +
        '[aria-modal="true"]',

      requestTimeoutSecs: 40,
      scrapingTool: "raw-http"
    };

    console.log("Searching keyword:", keyword);
    console.log("Apify input:", actorInput);

    const apifyResponse = await fetch(apifyEndpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APIFY_TOKEN}`
      },

      body: JSON.stringify(actorInput),

      signal: AbortSignal.timeout(240000)
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

    const rawItems = Array.isArray(apifyData)
      ? apifyData
      : [apifyData];

    const normalizedItems = rawItems
      .map((item, index) => normalizeRagResult(item, index))
      .filter((item) => item.url);

    const filteredItems = normalizedItems
      .filter((item) => !isBlockedUrl(item.url))
      .slice(0, 10);

    return res.json({
      success: true,
      keyword,
      count: filteredItems.length,
      results: filteredItems,

      debug: {
        rawResultCount: rawItems.length,
        normalizedCount: normalizedItems.length,
        blockedCount:
          normalizedItems.length - filteredItems.length,
        returnedCount: filteredItems.length
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
    position: index + 1,
    title,
    url,
    description,
    domain: getDomain(url),

    // Giữ lại để dùng ở bước phân tích article sau
    markdown
  };
}

function isBlockedUrl(url) {
  try {
    const hostname = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    const blockedDomains = [
      // Social media
      "facebook.com",
      "m.facebook.com",
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

      // Wikipedia / Wikimedia
      "wikipedia.org",
      "en.wikipedia.org",
      "de.wikipedia.org",
      "vi.wikipedia.org",
      "wikimedia.org",
      "commons.wikimedia.org",
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

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
