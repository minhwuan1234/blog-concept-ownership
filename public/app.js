const searchForm = document.querySelector("#search-form");
const searchButton = document.querySelector("#search-button");

const resultsTitle = document.querySelector("#results-title");
const resultsCount = document.querySelector("#results-count");
const resultsList = document.querySelector("#results-list");

const statusBox = document.querySelector("#status");
const resultTemplate = document.querySelector("#result-template");

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(searchForm);

  const keyword = String(
    formData.get("keyword") || ""
  ).trim();

  if (!keyword) {
    showError("Please enter a keyword.");
    return;
  }

  startLoading();

  try {
    const response = await fetch("/api/search", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        keyword
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Server returned a response that is not valid JSON."
      );
    }

    if (!response.ok || data.success === false) {
      throw new Error(
        data.details
          ? `${data.error}: ${data.details}`
          : data.error || "Search failed."
      );
    }

    renderResults(data);
  } catch (error) {
    console.error("Frontend search error:", error);

    showError(
      error?.message || "The search could not be completed."
    );
  } finally {
    stopLoading();
  }
});

function startLoading() {
  searchButton.disabled = true;
  searchButton.textContent = "Searching Google...";

  resultsTitle.textContent = "Searching...";
  resultsCount.textContent = "0 articles";

  resultsList.replaceChildren();

  statusBox.textContent =
    "Apify is collecting Google search results.";

  statusBox.className = "status";
}

function stopLoading() {
  searchButton.disabled = false;
  searchButton.textContent = "Run research search";
}

function renderResults(data) {
  const results = Array.isArray(data.results)
    ? data.results
    : [];

  resultsTitle.textContent =
    `Results for “${data.keyword || ""}”`;

  resultsCount.textContent =
    `${results.length} article${results.length === 1 ? "" : "s"}`;

  resultsList.replaceChildren();

  if (results.length === 0) {
    statusBox.textContent =
      "Apify completed the search, but no organic results were detected.";

    statusBox.className = "status";
    return;
  }

  statusBox.className = "status hidden";

  const fragment = document.createDocumentFragment();

  results.forEach((result, index) => {
    const item = resultTemplate.content.cloneNode(true);

    item.querySelector(".result-position").textContent =
      String(result.position || index + 1).padStart(2, "0");

    item.querySelector(".result-domain").textContent =
      result.domain || "Unknown domain";

    const titleElement =
      item.querySelector(".result-title");

    titleElement.textContent =
      result.title || "Untitled article";

    titleElement.href = result.url || "#";

    item.querySelector(".result-description").textContent =
      result.description ||
      "No search description available.";

    fragment.appendChild(item);
  });

  resultsList.appendChild(fragment);
}

function showError(message) {
  resultsTitle.textContent = "Search results";
  resultsCount.textContent = "0 articles";

  resultsList.replaceChildren();

  statusBox.textContent = message;
  statusBox.className = "status error";
}
