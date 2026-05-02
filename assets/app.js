const postGrid = document.querySelector("#archive");
const featuredPost = document.querySelector("#featuredPost");
const topicFilters = document.querySelector("#topicFilters");
const searchInput = document.querySelector("#searchInput");
const emptyState = document.querySelector("#emptyState");
const template = document.querySelector("#postCardTemplate");

let posts = [];
let activeTopic = "All";
let query = "";

const formatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

async function init() {
  try {
    const response = await fetch("data/posts.json", { cache: "no-store" });
    posts = response.ok ? await response.json() : [];
  } catch {
    posts = [];
  }

  posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  document.querySelector("#postCount").textContent = posts.length;
  document.querySelector("#latestDate").textContent = posts[0] ? formatter.format(new Date(posts[0].publishedAt)) : "Waiting";

  renderFilters();
  render();
}

function renderFilters() {
  const topics = ["All", ...new Set(posts.map((post) => post.category).filter(Boolean))].slice(0, 8);
  topicFilters.replaceChildren();

  for (const topic of topics) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = topic;
    button.setAttribute("aria-pressed", String(topic === activeTopic));
    button.addEventListener("click", () => {
      activeTopic = topic;
      renderFilters();
      render();
    });
    topicFilters.append(button);
  }
}

function render() {
  const filtered = posts.filter((post) => {
    const matchesTopic = activeTopic === "All" || post.category === activeTopic;
    const haystack = [post.title, post.excerpt, post.category, ...(post.sources || []).map((source) => source.title)].join(" ").toLowerCase();
    return matchesTopic && haystack.includes(query.toLowerCase());
  });

  renderFeatured(filtered[0]);
  postGrid.replaceChildren(...filtered.slice(1).map(createCard));
  emptyState.hidden = filtered.length > 0;
}

function renderFeatured(post) {
  if (!post) {
    featuredPost.replaceChildren();
    return;
  }

  const article = document.createElement("article");
  article.className = "feature-article";
  article.innerHTML = `
    <div class="post-body">
      <p class="category">${escapeHtml(post.category || "Trend")}</p>
      <h2>${escapeHtml(post.title)}</h2>
      <p>${escapeHtml(post.excerpt || "")}</p>
      ${(post.content || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </div>
    <aside>
      <p class="category">Sources</p>
      <ul class="source-list">
        ${(post.sources || []).slice(0, 5).map((source) => `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a></li>`).join("")}
      </ul>
    </aside>
  `;
  featuredPost.replaceChildren(article);
}

function createCard(post) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector(".category").textContent = post.category || "Trend";
  node.querySelector("h3").textContent = post.title;
  node.querySelector("p").textContent = post.excerpt || "";
  node.querySelector("time").dateTime = post.publishedAt;
  node.querySelector("time").textContent = formatter.format(new Date(post.publishedAt));
  node.querySelector("a").href = `#${post.slug}`;
  node.querySelector("a").addEventListener("click", (event) => {
    event.preventDefault();
    renderFeatured(post);
    featuredPost.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  return node;
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

document.querySelector(".searchbar").addEventListener("submit", (event) => {
  event.preventDefault();
  query = searchInput.value.trim();
  render();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value.trim();
  render();
});

init();
