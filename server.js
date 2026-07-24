import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
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
      "scraperlink~google-search-results-serp-scraper/" +
      "run-sync-get-dataset-items";

    const actorInput = {
  keyword,
  country: "US",
  limit: 10,
  page: 1
};

    console.log("Searching keyword:", keyword);
    console.log("Apify input:", actorInput);

    const apifyResponse = await fetch(apifyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APIFY_TOKEN}`
      },
      body: JSON.stringify(actorInput)
    });

    const responseText = await apifyResponse.text();

    console.log("Apify status:", apifyResponse.status);
    console.log("Apify raw response:", responseText.slice(0, 3000));

    if (!apifyResponse.ok) {
      return res.status(502).json({
        success: false,
        error: "Apify search failed",
        details: responseText.slice(0, 1000),
        results: []
      });
    }

    let apifyData;

    try {
      apifyData = JSON.parse(responseText);
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: "Apify returned invalid JSON",
        results: []
      });
    }

    const rawOrganicResults = findOrganicResults(apifyData);

    const results = rawOrganicResults
      .map((item, index) => normalizeResult(item, index))
      .filter((item) => item.url)
      .slice(0, 10);

    return res.json({
      success: true,
      keyword,
      count: results.length,
      results,

      debug: {
        apifyResponseType: Array.isArray(apifyData)
          ? "array"
          : typeof apifyData,

        rawOrganicCount: rawOrganicResults.length
      }
    });
  } catch (error) {
    console.error("Search route error:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Unexpected server error",
      results: []
    });
  }
});

function findOrganicResults(data) {
  if (!data) {
    return [];
  }

  const containers = Array.isArray(data) ? data : [data];

  const possibleResults = [];

  for (const container of containers) {
    if (!container || typeof container !== "object") {
      continue;
    }

    const candidates = [
      container.organic_results,
      container.organicResults,
      container.results,
      container.merged_results,
      container.mergedResults,
      container.items,

      container.data?.organic_results,
      container.data?.organicResults,
      container.data?.results,
      container.data?.merged_results,
      container.data?.items,

      container.result?.organic_results,
      container.result?.organicResults,
      container.result?.results
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        possibleResults.push(...candidate);
      }
    }

    if (
      container.url ||
      container.link ||
      container.href
    ) {
      possibleResults.push(container);
    }
  }

  return removeDuplicateResults(possibleResults);
}

function normalizeResult(item, index) {
  const url =
    item?.url ||
    item?.link ||
    item?.href ||
    item?.result_url ||
    "";

  const title =
    item?.title ||
    item?.name ||
    item?.headline ||
    item?.result_title ||
    "Untitled article";

  const description =
    item?.description ||
    item?.snippet ||
    item?.text ||
    item?.summary ||
    item?.result_description ||
    "";

  const position = Number(
    item?.position ||
    item?.rank ||
    item?.ranking ||
    item?.index ||
    index + 1
  );

  return {
    position,
    title,
    url,
    description,
    domain: getDomain(url)
  };
}

function removeDuplicateResults(items) {
  const seen = new Set();

  return items.filter((item) => {
    const url =
      item?.url ||
      item?.link ||
      item?.href ||
      item?.result_url;

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
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
