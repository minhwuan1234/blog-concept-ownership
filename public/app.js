const searchForm =
  document.querySelector("#search-form");

const searchButton =
  document.querySelector("#search-button");

const resultsTitle =
  document.querySelector("#results-title");

const resultsCount =
  document.querySelector("#results-count");

const resultsList =
  document.querySelector("#results-list");

const statusBox =
  document.querySelector("#status");

const resultTemplate =
  document.querySelector("#result-template");

const overviewStatus =
  document.querySelector("#overview-status");

const overviewMessage =
  document.querySelector("#overview-message");

const overviewContent =
  document.querySelector("#overview-content");

searchForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const formData =
      new FormData(searchForm);

    const keyword = String(
      formData.get("keyword") || ""
    ).trim();

    if (!keyword) {
      showArticleError(
        "Please enter a keyword."
      );

      return;
    }

    startLoading(keyword);

    try {
      const response =
        await fetch("/api/research", {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
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
          "Server returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Research request failed."
        );
      }

      renderResearch(data);
    } catch (error) {
      console.error(
        "Research frontend error:",
        error
      );

      showArticleError(
        error?.message ||
        "Research request failed."
      );

      showOverviewError(
        error?.message ||
        "AI Overview failed."
      );
    } finally {
      stopLoading();
    }
  }
);

function startLoading(keyword) {
  searchButton.disabled = true;
  searchButton.textContent =
    "Running research...";

  resultsTitle.textContent =
    `Searching for “${keyword}”`;

  resultsCount.textContent =
    "Searching";

  resultsList.replaceChildren();

  statusBox.textContent =
    "Apify is searching and crawling candidate articles.";

  statusBox.className =
    "status";

  overviewStatus.textContent =
    "Generating";

  overviewStatus.className =
    "overview-status loading";

  overviewMessage.textContent =
    "OpenAI is analysing the keyword independently.";

  overviewMessage.className =
    "overview-message";

  overviewContent.classList.add(
    "hidden"
  );
}

function stopLoading() {
  searchButton.disabled = false;
  searchButton.textContent =
    "Run research search";
}

function renderResearch(data) {
  if (data.overview?.success) {
    renderOverview(
      data.overview.data
    );
  } else {
    showOverviewError(
      data.overview?.error ||
      "AI Overview could not be generated."
    );
  }

  if (data.articles?.success) {
    renderResults(
      data.keyword,
      data.articles.results
    );
  } else {
    showArticleError(
      data.articles?.error ||
      "Articles could not be collected."
    );
  }
}

function renderOverview(overview) {
  const overviewData =
    overview?.overview || {};

  const overviewAnswer =
    document.querySelector(
      "#ai-overview-answer"
    );

  const overviewPoints =
    document.querySelector(
      "#ai-overview-points"
    );

  const overviewConfidence =
    document.querySelector(
      "#ai-overview-confidence"
    );

  overviewAnswer.textContent =
    overviewData.answer ||
    "No overview generated.";

  overviewPoints.replaceChildren();

  const keyPoints =
    Array.isArray(overviewData.keyPoints)
      ? overviewData.keyPoints
      : [];

  for (const point of keyPoints) {
    const listItem =
      document.createElement("li");

    listItem.textContent = point;

    overviewPoints.appendChild(listItem);
  }

  overviewConfidence.textContent =
    `${overviewData.confidence || "unknown"} confidence`;

  overviewConfidence.dataset.level =
    overviewData.confidence || "unknown";

  const sequence = [
    {
      key: "who",
      data: overview?.who
    },
    {
      key: "what",
      data: overview?.what
    },
    {
      key: "why",
      data: overview?.why
    }
  ];

  // Giữ nguyên phần code còn lại của hàm.
}

function showOverviewError(message) {
  overviewStatus.textContent =
    "Failed";

  overviewStatus.className =
    "overview-status error";

  overviewMessage.textContent = message;

  overviewMessage.className =
    "overview-message error";

  overviewContent.classList.add(
    "hidden"
  );
}

function renderResults(keyword, results) {
  const safeResults =
    Array.isArray(results)
      ? results
      : [];

  resultsTitle.textContent =
    `Results for “${keyword}”`;

  resultsCount.textContent =
    `${safeResults.length} article${
      safeResults.length === 1
        ? ""
        : "s"
    }`;

  resultsList.replaceChildren();

  if (!safeResults.length) {
    statusBox.textContent =
      "Search completed, but no eligible articles were found.";

    statusBox.className =
      "status";

    return;
  }

  statusBox.className =
    "status hidden";

  const fragment =
    document.createDocumentFragment();

  safeResults.forEach(
    (result, index) => {
      const item =
        resultTemplate.content.cloneNode(
          true
        );

      item.querySelector(
        ".result-position"
      ).textContent =
        String(
          result.position ||
          index + 1
        ).padStart(2, "0");

      item.querySelector(
        ".result-domain"
      ).textContent =
        result.domain ||
        "Unknown domain";

      const titleElement =
        item.querySelector(
          ".result-title"
        );

      titleElement.textContent =
        result.title ||
        "Untitled article";

      titleElement.href =
        result.url || "#";

      item.querySelector(
        ".result-description"
      ).textContent =
        result.description ||
        "No description available.";

      fragment.appendChild(item);
    }
  );

  resultsList.appendChild(fragment);
}

function showArticleError(message) {
  resultsTitle.textContent =
    "Search results";

  resultsCount.textContent =
    "Failed";

  resultsList.replaceChildren();

  statusBox.textContent = message;
  statusBox.className =
    "status error";
}
