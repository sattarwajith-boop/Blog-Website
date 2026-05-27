const list = document.querySelector("#archiveList");
const filters = document.querySelector("#archiveFilters");
const searchInput = document.querySelector("#archiveSearch");
const summary = document.querySelector("#archiveSummary");
const empty = document.querySelector("#archiveEmpty");
const loadMore = document.querySelector("#archiveLoadMore");

const pageSize = 18;
let posts = [];
let activeTopic = "All";
let query = "";
let visibleCount = pageSize;
const params = new URLSearchParams(window.location.search);
const initialCategory = params.get("category");

const formatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric"
});

async function initArchive() {
  list.innerHTML = Array.from({ length: 8 }, () => `<article class="archive-row skeleton-card"><span></span><strong></strong><p></p></article>`).join("");

  try {
    const response = await fetch("data/index.json", { cache: "no-store" });
    posts = response.ok ? await response.json() : [];
  } catch {
    posts = [];
  }

  posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (initialCategory && posts.some((post) => post.category?.toLowerCase() === initialCategory.toLowerCase())) {
    activeTopic = posts.find((post) => post.category?.toLowerCase() === initialCategory.toLowerCase()).category;
  }
  const topics = new Set(posts.map((post) => post.category).filter(Boolean));
  document.querySelector("#archiveTotal").textContent = posts.length;
  document.querySelector("#archiveTopics").textContent = topics.size;
  document.querySelector("#archiveLatest").textContent = posts[0] ? relativeAge(posts[0].publishedAt) : "New";
  renderFilters();
  renderArchive();
}

function renderFilters() {
  const topics = ["All", ...new Set(posts.map((post) => post.category).filter(Boolean))].slice(0, 10);
  filters.replaceChildren(...topics.map((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = topic;
    button.setAttribute("aria-pressed", String(topic === activeTopic));
    button.addEventListener("click", () => {
      activeTopic = topic;
      updateCategoryUrl();
      visibleCount = pageSize;
      renderFilters();
      renderArchive();
    });
    return button;
  }));
}

function renderArchive() {
  const filtered = filteredPosts();
  const visible = filtered.slice(0, visibleCount);
  list.replaceChildren(...visible.map(createRow));
  empty.hidden = filtered.length > 0;
  loadMore.hidden = filtered.length <= visibleCount;
  summary.textContent = resultText(filtered.length);
  updateArchiveHeading(filtered.length);
}

function filteredPosts() {
  const needle = query.toLowerCase();
  return posts.filter((post) => {
    const matchesTopic = activeTopic === "All" || post.category === activeTopic;
    const haystack = [post.title, post.excerpt, post.category, post.trend].join(" ").toLowerCase();
    return matchesTopic && haystack.includes(needle);
  });
}

function createRow(post) {
  const article = document.createElement("article");
  article.className = "archive-row";
  article.innerHTML = `
    <a href="posts/${escapeAttribute(post.slug)}.html">
      <time datetime="${escapeAttribute(post.publishedAt)}">${formatter.format(new Date(post.publishedAt))}</time>
      <div>
        <span class="category" data-cat="${escapeAttribute(post.category || "Trend")}">${escapeHtml(post.category || "Trend")}</span>
        <h2>${escapeHtml(post.title)}</h2>
        <p>${escapeHtml(post.excerpt || "")}</p>
      </div>
      <span class="archive-read">${escapeHtml(post.readingTime || "5 min")}</span>
    </a>
  `;
  return article;
}

function resultText(count) {
  if (!query && activeTopic === "All") return `${count} total briefings`;
  const topic = activeTopic === "All" ? "all topics" : activeTopic;
  return `${count} result${count === 1 ? "" : "s"} for ${query ? `"${query}"` : topic}`;
}

function updateCategoryUrl() {
  const next = new URL(window.location.href);
  if (activeTopic === "All") next.searchParams.delete("category");
  else next.searchParams.set("category", activeTopic);
  window.history.replaceState({}, "", next);
}

function updateArchiveHeading(count) {
  const title = activeTopic === "All" ? "Archive | ContextWire" : `${activeTopic} Articles | ContextWire`;
  document.title = title;
  const heroTitle = document.querySelector(".archive-hero h1");
  const heroLede = document.querySelector(".archive-hero .lede");
  const eyebrow = document.querySelector(".archive-hero .eyebrow");
  if (eyebrow) eyebrow.textContent = activeTopic === "All" ? "Full archive" : `${activeTopic} archive`;
  if (heroTitle) heroTitle.textContent = activeTopic === "All" ? "All briefings in one searchable index." : `${activeTopic} articles and source-checked briefings.`;
  if (heroLede) heroLede.textContent = activeTopic === "All"
    ? "Use the archive to scan recent topics, filter by category, and open any briefing directly."
    : `Browse ${count} ${activeTopic.toLowerCase()} article${count === 1 ? "" : "s"} from ContextWire.`;
}

function relativeAge(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "New";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function debounce(fn, wait = 160) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

document.querySelector(".archive-search").addEventListener("submit", (event) => {
  event.preventDefault();
  query = searchInput.value.trim();
  visibleCount = pageSize;
  renderArchive();
});

searchInput.addEventListener("input", debounce(() => {
  query = searchInput.value.trim();
  visibleCount = pageSize;
  renderArchive();
}));

loadMore.addEventListener("click", () => {
  visibleCount += pageSize;
  renderArchive();
});

initArchive();
