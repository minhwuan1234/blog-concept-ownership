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

      showOverviewError(
        "Please enter a keyword."
      );

      return;
    }

    startLoading(keyword);

    /**
     * Start both requests at the same time.
     *
     * Each request updates its own UI independently.
     */
    const articleRequest =
      requestArticles(keyword);

    const overviewRequest =
      requestOverview(keyword);

    await Promise.allSettled([
      articleRequest,
      overviewRequest
    ]);

    stopLoading();
  }
);

/**
 * OpenAI request.
 *
 * This does not wait for Apify.
 */
async function requestOverview(keyword) {
  try {
    const response =
      await fetch("/api/overview", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          keyword
        })
      });

    const data =
      await readJsonResponse(response);

    if (!response.ok || !data.success) {
      throw new Error(
        data.error ||
        "AI Overview could not be generated."
      );
    }

    renderOverview(data.data);
  } catch (error) {
    console.error(
      "Overview frontend error:",
      error
    );

    showOverviewError(
      error?.message ||
      "AI Overview could not be generated."
    );
  }
}

/**
 * Apify request.
 *
 * This does not wait for OpenAI.
 */
async function requestArticles(keyword) {
  try {
    const response =
      await fetch("/api/search", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          keyword
        })
      });

    const data =
      await readJsonResponse(response);

    if (!response.ok || !data.success) {
      throw new Error(
        data.error ||
        "Article search failed."
      );
    }

    renderResults(
      keyword,
      data.results
    );
  } catch (error) {
    console.error(
      "Article frontend error:",
      error
    );

    showArticleError(
      error?.message ||
      "Articles could not be collected."
    );
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(
      "Server returned invalid JSON."
    );
  }
}

function startLoading(keyword) {
  searchButton.disabled = true;
  searchButton.textContent =
    "Running research...";

  /*
   * Article loading state
   */
  resultsTitle.textContent =
    `Searching for “${keyword}”`;

  resultsCount.textContent =
    "Searching";

  resultsList.replaceChildren();

  statusBox.textContent =
    "Apify is searching and crawling candidate articles.";

  statusBox.className =
    "status";

  /*
   * OpenAI loading state
   */
  overviewStatus.textContent =
    "Generating";

  overviewStatus.className =
    "overview-status loading";

  overviewMessage.textContent =
    "OpenAI is analysing the keyword.";

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

function renderOverview(overview) {
  if (!overview) {
    showOverviewError(
      "OpenAI returned no overview data."
    );

    return;
  }

  renderAiOverview(
    overview.overview
  );

  const sequence = [
    {
      key: "who",
      data: overview.who
    },
    {
      key: "what",
      data: overview.what
    },
    {
      key: "why",
      data: overview.why
    }
  ];

  for (const section of sequence) {
    renderIntentSection(
      section.key,
      section.data
    );
  }

  overviewStatus.textContent =
    "Generated";

  overviewStatus.className =
    "overview-status success";

  overviewMessage.classList.add(
    "hidden"
  );

  overviewContent.classList.remove(
    "hidden"
  );
}

function renderAiOverview(data) {
  const overviewData = data || {};

  const answerElement =
    document.querySelector(
      "#ai-overview-answer"
    );

  const pointsElement =
    document.querySelector(
      "#ai-overview-points"
    );

  const confidenceElement =
    document.querySelector(
      "#ai-overview-confidence"
    );

  if (
    !answerElement ||
    !pointsElement ||
    !confidenceElement
  ) {
    throw new Error(
      "AI Overview elements are missing from index.html."
    );
  }

  answerElement.textContent =
    overviewData.answer ||
    "No overview generated.";

  pointsElement.replaceChildren();

  const keyPoints =
    Array.isArray(
      overviewData.keyPoints
    )
      ? overviewData.keyPoints
      : [];

  for (const point of keyPoints) {
    const listItem =
      document.createElement("li");

    listItem.textContent = point;

    pointsElement.appendChild(
      listItem
    );
  }

  setConfidence(
    confidenceElement,
    overviewData.confidence
  );
}

function renderIntentSection(
  key,
  sectionData
) {
  const safeData =
    sectionData || {};

  const summaryElement =
    document.querySelector(
      `#${key}-summary`
    );

  const detailsElement =
    document.querySelector(
      `#${key}-details`
    );

  const confidenceElement =
    document.querySelector(
      `#${key}-confidence`
    );

  if (
    !summaryElement ||
    !detailsElement ||
    !confidenceElement
  ) {
    throw new Error(
      `Missing HTML elements for ${key.toUpperCase()}.`
    );
  }

  summaryElement.textContent =
    safeData.summary ||
    "No summary generated.";

  detailsElement.replaceChildren();

  const details =
    Array.isArray(safeData.details)
      ? safeData.details
      : [];

  for (const detail of details) {
    const listItem =
      document.createElement("li");

    listItem.textContent = detail;

    detailsElement.appendChild(
      listItem
    );
  }

  setConfidence(
    confidenceElement,
    safeData.confidence
  );
}

function setConfidence(
  element,
  confidence
) {
  const level =
    confidence || "unknown";

  element.textContent =
    `${level} confidence`;

  element.dataset.level =
    level;
}

function showOverviewError(message) {
  overviewStatus.textContent =
    "Failed";

  overviewStatus.className =
    "overview-status error";

  overviewMessage.textContent =
    message;

  overviewMessage.className =
    "overview-message error";

  overviewContent.classList.add(
    "hidden"
  );
}

function renderResults(
  keyword,
  results
) {
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

  resultsList.appendChild(
    fragment
  );
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
