const postGrid = document.querySelector("#archive");
const featuredPost = document.querySelector("#featuredPost");
const topicFilters = document.querySelector("#topicFilters");
const searchInput = document.querySelector("#searchInput");
const emptyState = document.querySelector("#emptyState");
const loadMoreButton = document.querySelector("#loadMore");
const resultsSummary = document.querySelector("#resultsSummary");
const template = document.querySelector("#postCardTemplate");
const backToTop = document.querySelector(".back-to-top");

const pageSize = 6;
let posts = [];
let activeTopic = "All";
let query = "";
let visibleCount = pageSize;
let featuredSlug = "";
let cardObserver;

const formatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

async function init() {
  showSkeleton();

  try {
    const response = await fetch("data/index.json", { cache: "no-store" });
    posts = response.ok ? await response.json() : [];
  } catch {
    posts = [];
  }

  posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  document.querySelector("#postCount").textContent = posts.length;
  document.querySelector("#latestDate").textContent = posts[0] ? formatter.format(new Date(posts[0].publishedAt)) : "Waiting";
  document.querySelector("#sourceCount").textContent = posts.reduce((total, post) => total + (post.sourceCount || 0), 0);
  document.querySelector("#latestHeadline").textContent = posts[0] ? posts[0].title : "The trend desk is waiting for its first automated dispatch.";

  renderFilters();
  await render();
}

function showSkeleton() {
  postGrid.replaceChildren(...Array.from({ length: 6 }, () => {
    const card = document.createElement("article");
    card.className = "post-card skeleton-card";
    card.innerHTML = "<span></span><strong></strong><p></p>";
    return card;
  }));
}

function renderFilters() {
  const topics = ["All", ...new Set(posts.map((post) => post.category).filter(Boolean))].slice(0, 8);
  topicFilters.replaceChildren();

  for (const topic of topics) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = topic;
    button.setAttribute("aria-pressed", String(topic === activeTopic));
    button.addEventListener("click", async () => {
      activeTopic = topic;
      visibleCount = pageSize;
      renderFilters();
      await render();
    });
    topicFilters.append(button);
  }
}

async function render() {
  const filtered = filteredPosts();
  const lead = filtered[0];
  const cards = filtered.slice(1, visibleCount + 1);

  await renderFeatured(lead);
  postGrid.replaceChildren(...cards.map(createCard));
  observeCards();
  emptyState.hidden = filtered.length > 0;
  loadMoreButton.hidden = filtered.length <= visibleCount + 1;
  resultsSummary.textContent = resultText(filtered.length);
}

function filteredPosts() {
  const needle = query.toLowerCase();
  return posts.filter((post) => {
    const matchesTopic = activeTopic === "All" || post.category === activeTopic;
    const haystack = [post.title, post.excerpt, post.category, post.trend].join(" ").toLowerCase();
    return matchesTopic && haystack.includes(needle);
  });
}

function resultText(count) {
  if (!query && activeTopic === "All") return `${count} latest briefings`;
  const topic = activeTopic === "All" ? "all topics" : activeTopic;
  return `${count} result${count === 1 ? "" : "s"} for ${query ? `"${query}"` : topic}`;
}

async function renderFeatured(meta) {
  if (!meta) {
    featuredSlug = "";
    featuredPost.replaceChildren();
    return;
  }

  featuredSlug = meta.slug;
  featuredPost.innerHTML = `<article class="feature-article loading-panel"><div class="post-body"><p class="category">Loading</p><h2>${escapeHtml(meta.title)}</h2><p>Opening the full briefing...</p></div></article>`;

  const post = await fetchPost(meta.slug);
  if (featuredSlug !== meta.slug) return;

  const article = document.createElement("article");
  article.className = "feature-article";
  article.innerHTML = `
    <div class="post-body">
      ${post.image?.url ? `
        <figure class="feature-image">
          <img src="${escapeAttribute(post.image.url)}" alt="${escapeAttribute(post.image.alt || `${post.title} image`)}" width="1400" height="788" loading="eager" decoding="async" fetchpriority="high">
          <figcaption>${escapeHtml(post.image.credit || "Editorial image")}</figcaption>
        </figure>
      ` : ""}
      <p class="category" data-cat="${escapeAttribute(post.category || "Trend")}">${escapeHtml(post.category || "Trend")}</p>
      <h2>${escapeHtml(post.title)}</h2>
      <div class="feature-meta">
        <time datetime="${escapeAttribute(post.publishedAt)}">${formatter.format(new Date(post.publishedAt))}</time>
        <span>${readingTime(post)} read</span>
        <span>${(post.sources || []).length} sources</span>
      </div>
      <p>${escapeHtml(post.excerpt || "")}</p>
      ${(post.content || []).slice(0, 3).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      <p><a class="read-more-link" href="posts/${escapeAttribute(post.slug)}.html">Read the full article</a></p>
    </div>
    <aside class="source-panel">
      <p class="category" data-cat="${escapeAttribute(post.category || "Trend")}">Sources</p>
      <p>Primary links gathered by the automation for quick verification.</p>
      <ul class="source-list">
        ${(post.sources || []).slice(0, 5).map((source) => `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a></li>`).join("")}
      </ul>
    </aside>
  `;
  featuredPost.replaceChildren(article);
}

async function fetchPost(slug) {
  try {
    const response = await fetch(`data/posts/${slug}.json`, { cache: "no-store" });
    if (response.ok) return await response.json();
  } catch {
    // Fall back to metadata below.
  }
  return posts.find((post) => post.slug === slug) || {};
}

function createCard(post) {
  const node = template.content.firstElementChild.cloneNode(true);
  if (post.image?.url) {
    const image = document.createElement("img");
    image.className = "card-image";
    image.src = post.image.url;
    image.alt = post.image.alt || `${post.title} image`;
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 640;
    image.height = 400;
    node.querySelector(".card-link").prepend(image);
  }
  const category = node.querySelector(".category");
  category.textContent = post.category || "Trend";
  category.dataset.cat = post.category || "Trend";
  node.querySelector("h3").textContent = post.title;
  node.querySelector("p").textContent = post.excerpt || "";
  node.querySelector("time").dateTime = post.publishedAt;
  node.querySelector("time").textContent = formatter.format(new Date(post.publishedAt));
  node.querySelector(".reading-time").textContent = post.readingTime || "5 min";
  node.querySelector("a").href = `posts/${post.slug}.html`;
  return node;
}

function observeCards() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".post-card").forEach((card) => card.classList.add("visible"));
    return;
  }

  cardObserver?.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      cardObserver.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".post-card").forEach((card, index) => {
    card.style.transitionDelay = `${Math.min(index, 6) * 45}ms`;
    cardObserver.observe(card);
  });
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

function readingTime(post) {
  const words = [post.title, post.excerpt, ...(post.content || [])].join(" ").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 190))} min`;
}

function debounce(fn, wait = 160) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

document.querySelector(".searchbar").addEventListener("submit", async (event) => {
  event.preventDefault();
  query = searchInput.value.trim();
  visibleCount = pageSize;
  await render();
});

searchInput.addEventListener("input", debounce(async () => {
  query = searchInput.value.trim();
  visibleCount = pageSize;
  await render();
}));

loadMoreButton.addEventListener("click", async () => {
  visibleCount += pageSize;
  await render();
});

window.addEventListener("scroll", () => {
  if (!backToTop) return;
  backToTop.classList.toggle("visible", window.scrollY > 720);
}, { passive: true });

backToTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

init();
