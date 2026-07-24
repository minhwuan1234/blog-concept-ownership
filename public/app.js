const searchForm =
  document.querySelector(
    "#search-form"
  );

const searchButton =
  document.querySelector(
    "#search-button"
  );

const resourcesStatus =
  document.querySelector(
    "#resources-status"
  );

const resourceElements = {
  past_content_examples:
    document.querySelector(
      "#resource-past-content"
    ),

  team_voice_guide:
    document.querySelector(
      "#resource-team-voice"
    ),

  company_positioning:
    document.querySelector(
      "#resource-company-positioning"
    )
};

const overviewStatus =
  document.querySelector(
    "#overview-status"
  );

const overviewMessage =
  document.querySelector(
    "#overview-message"
  );

const overviewContent =
  document.querySelector(
    "#overview-content"
  );

const competitorStatus =
  document.querySelector(
    "#competitor-status"
  );

const competitorMessage =
  document.querySelector(
    "#competitor-message"
  );

const competitorMap =
  document.querySelector(
    "#competitor-map"
  );

const anglesCount =
  document.querySelector(
    "#angles-count"
  );

const anglesMessage =
  document.querySelector(
    "#angles-message"
  );

const anglesList =
  document.querySelector(
    "#angles-list"
  );

const questionsCount =
  document.querySelector(
    "#questions-count"
  );

const questionsMessage =
  document.querySelector(
    "#questions-message"
  );

const questionsList =
  document.querySelector(
    "#questions-list"
  );

const resultsTitle =
  document.querySelector(
    "#results-title"
  );

const resultsCount =
  document.querySelector(
    "#results-count"
  );

const resultsList =
  document.querySelector(
    "#results-list"
  );

const statusBox =
  document.querySelector(
    "#status"
  );

const resultTemplate =
  document.querySelector(
    "#result-template"
  );

searchForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const formData =
      new FormData(
        searchForm
      );

    const keyword =
      String(
        formData.get(
          "keyword"
        ) || ""
      ).trim();

    const companyContext =
      String(
        formData.get(
          "companyContext"
        ) || ""
      ).trim();

    if (!keyword) {
      showOverviewError(
        "Please enter a keyword."
      );

      showCompetitorError(
        "Please enter a keyword."
      );

      return;
    }

    startLoading(keyword);

    /**
     * Both branches start at the same time.
     */
    const overviewRequest =
      requestOverview(
        keyword
      );

    const competitorRequest =
      requestCompetitorResearch({
        keyword,
        companyContext
      });

    await Promise.allSettled([
      overviewRequest,
      competitorRequest
    ]);

    stopLoading();
  }
);

async function requestOverview(
  keyword
) {
  try {
    const response =
      await fetch(
        "/api/overview",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              keyword
            })
        }
      );

    const data =
      await readJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        data.error ||
        "Keyword overview failed."
      );
    }

    renderOverview(
      data.data
    );
  } catch (error) {
    console.error(
      "Overview error:",
      error
    );

    showOverviewError(
      error?.message ||
      "Keyword overview failed."
    );
  }
}

async function requestCompetitorResearch({
  keyword,
  companyContext
}) {
  try {
    const response =
      await fetch(
        "/api/competitor-research",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              keyword,
              companyContext
            })
        }
      );

    const data =
      await readJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        data.error ||
        "Competitor research failed."
      );
    }

    renderArticles(
      keyword,
      data.articles
    );

    if (!data.research) {
      showCompetitorError(
        data.warning ||
        "No competitor research was generated."
      );

      return;
    }

    renderCompetitorResearch(
      data.research
    );
  } catch (error) {
    console.error(
      "Competitor research error:",
      error
    );

    showCompetitorError(
      error?.message ||
      "Competitor research failed."
    );

    showArticleError(
      error?.message ||
      "Articles could not be collected."
    );
  }
}

async function readJsonResponse(
  response
) {
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

  overviewStatus.textContent =
    "Generating";

  overviewStatus.className =
    "panel-status loading";

  overviewMessage.textContent =
    "OpenAI is analysing the keyword.";

  overviewMessage.className =
    "panel-message";

  overviewContent.classList.add(
    "hidden"
  );

  competitorStatus.textContent =
    "Analysing";

  competitorStatus.className =
    "panel-status loading";

  competitorMessage.textContent =
    "Apify is crawling competitor articles. OpenAI will analyse their Markdown after extraction.";

  competitorMessage.className =
    "panel-message";

  competitorMap.classList.add(
    "hidden"
  );

  competitorMap.replaceChildren();

  anglesCount.textContent =
    "0 angles";

  anglesMessage.textContent =
    "Waiting for competitor analysis.";

  anglesMessage.className =
    "panel-message";

  anglesList.classList.add(
    "hidden"
  );

  anglesList.replaceChildren();

  questionsCount.textContent =
    "0 questions";

  questionsMessage.textContent =
    "Waiting for competitor analysis.";

  questionsMessage.className =
    "panel-message";

  questionsList.classList.add(
    "hidden"
  );

  questionsList.replaceChildren();

  resultsTitle.textContent =
    `Searching for “${keyword}”`;

  resultsCount.textContent =
    "Searching";

  resultsList.replaceChildren();

  statusBox.textContent =
    "Apify is searching and extracting Markdown.";

  statusBox.className =
    "panel-message";
}

function stopLoading() {
  searchButton.disabled = false;

  searchButton.textContent =
    "Run research";
}

function renderOverview(
  data
) {
  if (!data) {
    showOverviewError(
      "No overview data was returned."
    );

    return;
  }

  renderAiOverview(
    data.overview
  );

  renderIntentSection(
    "who",
    data.who
  );

  renderIntentSection(
    "what",
    data.what
  );

  renderIntentSection(
    "why",
    data.why
  );

  overviewStatus.textContent =
    "Generated";

  overviewStatus.className =
    "panel-status success";

  overviewMessage.classList.add(
    "hidden"
  );

  overviewContent.classList.remove(
    "hidden"
  );
}

function renderAiOverview(data) {
  const safeData =
    data || {};

  const answer =
    document.querySelector(
      "#ai-overview-answer"
    );

  const points =
    document.querySelector(
      "#ai-overview-points"
    );

  const confidence =
    document.querySelector(
      "#ai-overview-confidence"
    );

  answer.textContent =
    safeData.answer ||
    "No overview generated.";

  renderList(
    points,
    safeData.keyPoints
  );

  setConfidence(
    confidence,
    safeData.confidence
  );
}

function renderIntentSection(
  key,
  data
) {
  const safeData =
    data || {};

  const summary =
    document.querySelector(
      `#${key}-summary`
    );

  const details =
    document.querySelector(
      `#${key}-details`
    );

  const confidence =
    document.querySelector(
      `#${key}-confidence`
    );

  summary.textContent =
    safeData.summary ||
    "No summary generated.";

  renderList(
    details,
    safeData.details
  );

  setConfidence(
    confidence,
    safeData.confidence
  );
}

function renderCompetitorResearch(
  research
) {
  renderCompetitorMap(
    research.competitorMap
  );

  renderAngles(
    research.exclusiveAngles
  );

  renderQuestions(
    research.openQuestions
  );

  competitorStatus.textContent =
    "Generated";

  competitorStatus.className =
    "panel-status success";

  competitorMessage.classList.add(
    "hidden"
  );

  competitorMap.classList.remove(
    "hidden"
  );
}

function renderCompetitorMap(
  items
) {
  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  competitorMap.replaceChildren();

  for (const item of safeItems) {
    const card =
      document.createElement(
        "article"
      );

    card.className =
      "competitor-card";

    const header =
      document.createElement(
        "div"
      );

    header.className =
      "competitor-card-header";

    const titleWrap =
      document.createElement(
        "div"
      );

    const articleId =
      document.createElement(
        "span"
      );

    articleId.className =
      "article-id";

    articleId.textContent =
      item.articleId;

    const title =
      document.createElement(
        "a"
      );

    title.className =
      "competitor-title";

    title.href =
      item.url || "#";

    title.target =
      "_blank";

    title.rel =
      "noopener noreferrer";

    title.textContent =
      item.title ||
      "Untitled article";

    titleWrap.append(
      articleId,
      title
    );

    const status =
      document.createElement(
        "span"
      );

    status.className =
      "analysis-status";

    status.dataset.status =
      item.analysisStatus;

    status.textContent =
      formatLabel(
        item.analysisStatus
      );

    header.append(
      titleWrap,
      status
    );

    const columns =
      document.createElement(
        "div"
      );

    columns.className =
      "analysis-columns";

    columns.append(
      createAnalysisColumn(
        "Strengths to match",
        item.strengths,
        "strength"
      ),

      createAnalysisColumn(
        "Weaknesses / gaps",
        item.weaknesses,
        "weakness"
      )
    );

    const note =
      document.createElement(
        "p"
      );

    note.className =
      "analysis-note";

    note.textContent =
      item.analysisNote ||
      "";

    card.append(
      header,
      columns,
      note
    );

    competitorMap.appendChild(
      card
    );
  }
}

function createAnalysisColumn(
  heading,
  items,
  type
) {
  const column =
    document.createElement(
      "section"
    );

  column.className =
    `analysis-column ${type}`;

  const title =
    document.createElement(
      "h4"
    );

  title.textContent =
    heading;

  const list =
    document.createElement(
      "div"
    );

  list.className =
    "analysis-items";

  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  if (!safeItems.length) {
    const empty =
      document.createElement(
        "p"
      );

    empty.className =
      "empty-analysis";

    empty.textContent =
      "No supported points found.";

    list.appendChild(empty);
  }

  for (const item of safeItems) {
    const block =
      document.createElement(
        "div"
      );

    block.className =
      "analysis-item";

    const point =
      document.createElement(
        "strong"
      );

    point.textContent =
      item.point || "";

    const evidence =
      document.createElement(
        "p"
      );

    evidence.textContent =
      item.evidence || "";

    block.append(
      point,
      evidence
    );

    if (
      type ===
        "weakness" &&
      item.opportunity
    ) {
      const opportunity =
        document.createElement(
          "p"
        );

      opportunity.className =
        "opportunity";

      opportunity.textContent =
        `Opportunity: ${item.opportunity}`;

      block.appendChild(
        opportunity
      );
    }

    list.appendChild(
      block
    );
  }

  column.append(
    title,
    list
  );

  return column;
}

function renderAngles(items) {
  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  anglesCount.textContent =
    `${safeItems.length} angle${
      safeItems.length === 1
        ? ""
        : "s"
    }`;

  anglesList.replaceChildren();

  if (!safeItems.length) {
    anglesMessage.textContent =
      "No exclusive angles were identified.";

    anglesMessage.className =
      "panel-message";

    anglesList.classList.add(
      "hidden"
    );

    return;
  }

  anglesMessage.classList.add(
    "hidden"
  );

  anglesList.classList.remove(
    "hidden"
  );

  safeItems.forEach(
    (item, index) => {
      const card =
        document.createElement(
          "article"
        );

      card.className =
        "angle-card";

      const header =
        document.createElement(
          "div"
        );

      header.className =
        "angle-header";

      const number =
        document.createElement(
          "span"
        );

      number.className =
        "angle-number";

      number.textContent =
        String(
          index + 1
        ).padStart(
          2,
          "0"
        );

      const ownership =
        document.createElement(
          "span"
        );

      ownership.className =
        "ownership-status";

      ownership.dataset.status =
        item.ownershipStatus;

      ownership.textContent =
        formatLabel(
          item.ownershipStatus
        );

      header.append(
        number,
        ownership
      );

      const title =
        document.createElement(
          "h3"
        );

      title.textContent =
        item.angle || "";

      const body =
        document.createElement(
          "div"
        );

      body.className =
        "angle-details";

      body.append(
        createLabeledText(
          "Why it matters",
          item.whyItMatters
        ),

        createLabeledText(
          "Competitor gap",
          item.competitorGap
        ),

        createLabeledText(
          "Why the team can own it",
          item.whyTeamCanOwnIt
        ),

        createLabeledList(
          "Required internal evidence",
          item.requiredInternalEvidence
        )
      );

      const share =
        document.createElement(
          "div"
        );

      share.className =
        "article-share";

      share.textContent =
        `Suggested article share: ${item.recommendedArticleSharePercent || 0}%`;

      card.append(
        header,
        title,
        body,
        share
      );

      anglesList.appendChild(
        card
      );
    }
  );
}

function renderQuestions(items) {
  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  questionsCount.textContent =
    `${safeItems.length} question${
      safeItems.length === 1
        ? ""
        : "s"
    }`;

  questionsList.replaceChildren();

  if (!safeItems.length) {
    questionsMessage.textContent =
      "No open questions were generated.";

    questionsMessage.className =
      "panel-message";

    questionsList.classList.add(
      "hidden"
    );

    return;
  }

  questionsMessage.classList.add(
    "hidden"
  );

  questionsList.classList.remove(
    "hidden"
  );

  safeItems.forEach(
    (item, index) => {
      const card =
        document.createElement(
          "article"
        );

      card.className =
        "question-card";

      const header =
        document.createElement(
          "div"
        );

      header.className =
        "question-header";

      const number =
        document.createElement(
          "span"
        );

      number.textContent =
        `Q${index + 1}`;

      const priority =
        document.createElement(
          "span"
        );

      priority.className =
        "priority";

      priority.dataset.level =
        item.priority;

      priority.textContent =
        `${item.priority || "unknown"} priority`;

      header.append(
        number,
        priority
      );

      const question =
        document.createElement(
          "h3"
        );

      question.textContent =
        item.question || "";

      const reason =
        createLabeledText(
          "Why this question exists",
          item.reason
        );

      const source =
        createLabeledText(
          "Required source type",
          item.requiredSourceType
        );

      const triggered =
        createLabeledList(
          "Triggered by",
          item.triggeredByArticleIds
        );

      card.append(
        header,
        question,
        reason,
        source,
        triggered
      );

      questionsList.appendChild(
        card
      );
    }
  );
}

function renderArticles(
  keyword,
  items
) {
  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  resultsTitle.textContent =
    `Results for “${keyword}”`;

  resultsCount.textContent =
    `${safeItems.length} article${
      safeItems.length === 1
        ? ""
        : "s"
    }`;

  resultsList.replaceChildren();

  if (!safeItems.length) {
    statusBox.textContent =
      "No eligible competitor articles were found.";

    statusBox.className =
      "panel-message";

    return;
  }

  statusBox.classList.add(
    "hidden"
  );

  const fragment =
    document.createDocumentFragment();

  safeItems.forEach(
    (result, index) => {
      const node =
        resultTemplate
          .content
          .cloneNode(true);

      node
        .querySelector(
          ".result-position"
        )
        .textContent =
          String(
            result.position ||
            index + 1
          ).padStart(
            2,
            "0"
          );

      node
        .querySelector(
          ".result-domain"
        )
        .textContent =
          result.domain ||
          "Unknown domain";

      const title =
        node.querySelector(
          ".result-title"
        );

      title.textContent =
        result.title ||
        "Untitled article";

      title.href =
        result.url || "#";

      node
        .querySelector(
          ".result-description"
        )
        .textContent =
          result.description ||
          "No description available.";

      fragment.appendChild(
        node
      );
    }
  );

  resultsList.appendChild(
    fragment
  );
}

function showOverviewError(message) {
  overviewStatus.textContent =
    "Failed";

  overviewStatus.className =
    "panel-status error";

  overviewMessage.textContent =
    message;

  overviewMessage.className =
    "panel-message error";

  overviewContent.classList.add(
    "hidden"
  );
}

function showCompetitorError(message) {
  competitorStatus.textContent =
    "Failed";

  competitorStatus.className =
    "panel-status error";

  competitorMessage.textContent =
    message;

  competitorMessage.className =
    "panel-message error";

  competitorMap.classList.add(
    "hidden"
  );

  anglesMessage.textContent =
    message;

  anglesMessage.className =
    "panel-message error";

  questionsMessage.textContent =
    message;

  questionsMessage.className =
    "panel-message error";
}

function showArticleError(message) {
  resultsTitle.textContent =
    "Search Results";

  resultsCount.textContent =
    "Failed";

  resultsList.replaceChildren();

  statusBox.textContent =
    message;

  statusBox.className =
    "panel-message error";
}

function renderList(
  element,
  items
) {
  element.replaceChildren();

  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  for (const item of safeItems) {
    const li =
      document.createElement(
        "li"
      );

    li.textContent =
      item;

    element.appendChild(
      li
    );
  }
}

function setConfidence(
  element,
  level
) {
  const safeLevel =
    level || "unknown";

  element.textContent =
    `${safeLevel} confidence`;

  element.dataset.level =
    safeLevel;
}

function createLabeledText(
  label,
  value
) {
  const container =
    document.createElement(
      "div"
    );

  container.className =
    "labeled-content";

  const heading =
    document.createElement(
      "strong"
    );

  heading.textContent =
    label;

  const body =
    document.createElement(
      "p"
    );

  body.textContent =
    value || "Not provided.";

  container.append(
    heading,
    body
  );

  return container;
}

function createLabeledList(
  label,
  items
) {
  const container =
    document.createElement(
      "div"
    );

  container.className =
    "labeled-content";

  const heading =
    document.createElement(
      "strong"
    );

  heading.textContent =
    label;

  const list =
    document.createElement(
      "ul"
    );

  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  for (const item of safeItems) {
    const li =
      document.createElement(
        "li"
      );

    li.textContent =
      item;

    list.appendChild(
      li
    );
  }

  container.append(
    heading,
    list
  );

  return container;
}

function formatLabel(value) {
  return String(value || "")
    .replace(
      /_/g,
      " "
    )
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}
async function loadResearchResources() {
  setResourcesStatus(
    "Loading",
    "loading"
  );

 Object.values(
  resourceElements
).forEach((element) => {
  element?.addEventListener(
    "click",
    (event) => {
      if (
        element.getAttribute(
          "aria-disabled"
        ) === "true"
      ) {
        event.preventDefault();
      }
    }
  );
});
  
  try {
    const response =
      await fetch(
        "/api/research-resources"
      );

    const data =
      await readJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        data.error ||
        "Research resources could not be loaded."
      );
    }

    const resources =
      Array.isArray(data.resources)
        ? data.resources
        : [];

    let connectedCount = 0;

    for (const resource of resources) {
      const element =
        resourceElements[
          resource.id
        ];

      if (!element) {
        continue;
      }

      updateResourceLink(
        element,
        resource
      );

      if (resource.configured) {
        connectedCount += 1;
      }
    }

    setResourcesStatus(
      `${connectedCount}/3 connected`,
      connectedCount === 3
        ? "success"
        : "partial"
    );
  } catch (error) {
    console.error(
      "Research resources error:",
      error
    );

    setResourcesStatus(
      "Unavailable",
      "error"
    );
  }
}

function updateResourceLink(
  element,
  resource
) {
  const statusText =
    element.querySelector(
      ".resource-info span"
    );

  element.classList.remove(
    "is-loading",
    "is-connected",
    "is-missing"
  );

  if (
    resource.configured &&
    resource.url
  ) {
    element.href =
      resource.url;

    element.classList.add(
      "is-connected"
    );

    element.setAttribute(
      "aria-disabled",
      "false"
    );

    statusText.textContent =
      "Open Supabase file";

    return;
  }

  element.href = "#";

  element.classList.add(
    "is-missing"
  );

  element.setAttribute(
    "aria-disabled",
    "true"
  );

  statusText.textContent =
    "Not connected";
}

function setResourcesStatus(
  text,
  state
) {
  if (!resourcesStatus) {
    return;
  }

  resourcesStatus.textContent =
    text;

  resourcesStatus.className =
    `resources-status ${state}`;
}
