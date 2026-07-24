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
    const keyword = String(req.body.keyword || "").trim();

    const countryCode = String(
      req.body.countryCode || "us"
    ).toLowerCase();

    const languageCode = String(
      req.body.languageCode || "en"
    ).toLowerCase();

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required"
      });
    }

    if (!APIFY_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "APIFY_TOKEN has not been configured"
      });
    }

    const actorInput = {
      queries: keyword,
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      countryCode,
      languageCode,
      includeUnfilteredResults: false,
      saveHtml: false
    };

    const apifyUrl =
      "https://api.apify.com/v2/acts/apify~google-search-scraper/" +
      "run-sync-get-dataset-items" +
      `?token=${encodeURIComponent(APIFY_TOKEN)}` +
      "&format=json" +
      "&clean=true";

    const apifyResponse = await fetch(apifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(actorInput)
    });

    if (!apifyResponse.ok) {
      const apifyError = await apifyResponse.text();

      console.error("Apify error:", apifyError);

      return res.status(502).json({
        success: false,
        error: "Apify could not complete the Google search"
      });
    }

    const apifyData = await apifyResponse.json();

    const organicResults = apifyData.flatMap((page) => {
      return Array.isArray(page.organicResults)
        ? page.organicResults
        : [];
    });

    const results = organicResults
      .slice(0, 10)
      .map((item, index) => ({
        position: item.position || index + 1,
        title: item.title || "Untitled article",
        url: item.url || "",
        description: item.description || "",
        domain: getDomain(item.url)
      }));

    return res.json({
      success: true,
      keyword,
      countryCode,
      languageCode,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("Search error:", error);

    return res.status(500).json({
      success: false,
      error: "An unexpected server error occurred"
    });
  }
});

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
