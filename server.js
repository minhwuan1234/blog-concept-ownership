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

app.post("/api/search", async (req, res) => {
  try {
    const keyword = String(req.body.keyword || "").trim();

    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: "Keyword is required"
      });
    }

    if (!APIFY_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "APIFY_TOKEN is missing"
      });
    }

    const apifyEndpoint =
      "https://api.apify.com/v2/actors/" +
      "scraperlink~google-search-results-serp-scraper/" +
      "run-sync-get-dataset-items";

    const actorInput = {
      country: "US",
      include_merged: true,
      keyword: keyword,
      limit: "10",
      lr: "lang_en",
      start: 1
    };

    const apifyResponse = await fetch(apifyEndpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APIFY_TOKEN}`
      },

      body: JSON.stringify(actorInput)
    });

    const responseText = await apifyResponse.text();

    if (!apifyResponse.ok) {
      console.error("Apify error:", responseText);

      return res.status(502).json({
        success: false,
        error: "Apify search failed",
        details: responseText
      });
    }

    const apifyData = JSON.parse(responseText);

    return res.json({
      success: true,
      keyword,
      count: Array.isArray(apifyData)
        ? apifyData.length
        : 0,
      rawResults: apifyData
    });
  } catch (error) {
    console.error("Search error:", error);

    return res.status(500).json({
      success: false,
      error: "Unexpected server error"
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
