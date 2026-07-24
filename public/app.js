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

  const requestData = {
    keyword: formData.get("keyword"),
    countryCode: formData.get("countryCode"),
    languageCode: formData.get("languageCode")
  };

  startLoading();

  try {
    const response = await fetch("/api/search", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(requestData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "The search could not be completed"
      );
    }

    renderResults(data);
  } catch (error) {
    showError(error.message);
  } finally {
    stopLoading();
  }
});

function startLoading() {
  searchButton.disabled = true;
  searchButton.textContent = "Searching Google...";

  resultsTitle.textContent = "Searching...";
  resultsCount.textContent = "0 articles";

  resultsList.innerHTML = "";

  statusBox.textContent =
    "Apify is collecting the first Google result page.";

  statusBox.className = "status";
}

function stopLoading() {
  searchButton.disabled = false;
  searchButton.textContent = "Run research search";
}

function renderResults(data) {
  resultsTitle.textContent = `Results for “${data.keyword}”`;

  resultsCount.textContent =
    `${data.count} article${data.count === 1 ? "" : "s"}`;

  resultsList.innerHTML = "";

  if (!data.results.length) {
    statusBox.textContent =
      "Search completed, but no organic articles were found.";

    statusBox.className = "status";

    return;
  }

  statusBox.className = "status hidden";

  data.results.forEach((result) => {
    const item = resultTemplate.content.cloneNode(true);

    item.querySelector(".result-position").textContent =
      String(result.position).padStart(2, "0");

    item.querySelector(".result-domain").textContent =
      result.domain || "Unknown domain";

    const titleElement =
      item.querySelector(".result-title");

    titleElement.textContent = result.title;
    titleElement.href = result.url;

    item.querySelector(".result-description").textContent =
      result.description || "No search description available.";

    resultsList.appendChild(item);
  });
}

function showError(message) {
  resultsTitle.textContent = "Search results";
  resultsCount.textContent = "0 articles";

  resultsList.innerHTML = "";

  statusBox.textContent = message;
  statusBox.className = "status error";
}
