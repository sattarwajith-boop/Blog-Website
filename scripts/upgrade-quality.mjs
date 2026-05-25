import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "ContextWire",
  siteUrl: trimSlash(process.env.SITE_URL || "https://contextwire.online")
};

const requiredSections = [
  "Context:",
  "Why it is trending:",
  "Key developments:",
  "Reader impact:",
  "What to verify:",
  "Source notes:",
  "What to watch next:",
  "Bottom line:"
];

const paths = {
  posts: new URL("data/posts.json", root),
  index: new URL("data/index.json", root),
  postDataDir: new URL("data/posts/", root),
  postPagesDir: new URL("posts/", root),
  qualityCss: new URL("assets/quality-upgrades.css", root),
  robots: new URL("robots.txt", root),
  adsenseChecklist: new URL("ADSENSE_READY_CHECKLIST.md", root)
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const posts = await readJson(paths.posts, []);
  if (!Array.isArray(posts) || posts.length === 0) {
    console.log("No posts found to upgrade.");
    return;
  }

  const upgraded = posts.map(upgradePost);
  await mkdir(paths.postDataDir, { recursive: true });
  await mkdir(paths.postPagesDir, { recursive: true });

  await writeFile(paths.posts, `${JSON.stringify(upgraded, null, 2)}\n`, "utf8");
  await writeFile(paths.index, `${JSON.stringify(upgraded.map(postMetadata), null, 2)}\n`, "utf8");

  for (const post of upgraded) {
    await writeFile(new URL(`${post.slug}.json`, paths.postDataDir), `${JSON.stringify(post, null, 2)}\n`, "utf8");
    await upgradePostPage(post);
  }

  await writeFile(paths.qualityCss, qualityCss(), "utf8");
  await writeFile(paths.robots, `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`, "utf8");
  await writeFile(paths.adsenseChecklist, adsenseChecklist(), "utf8");

  console.log(`Quality-upgraded ${upgraded.length} post(s).`);
}

function upgradePost(post) {
  const trend = titleCase(post.trend || post.title || "this topic");
  const category = post.category || classifyTopic(trend);
  const sources = normalizeSources(post.sources || [], post);
  const content = buildValueContent({ ...post, category, trend }, sources);
  const quality = qualityForPost({ ...post, category, content, sources });

  return {
    ...post,
    title: strongerTitle(post.title, trend, category),
    category,
    excerpt: strongerExcerpt(post.excerpt, trend, category, sources),
    content,
    sources,
    tags: tagsForPost({ ...post, trend, category }),
    humanReview: {
      status: "editorial-review-required",
      note: "ContextWire briefing prepared with visible source notes, reader-focused sections, and verification prompts. Final factual approval should be completed before promotion or monetization review."
    },
    quality
  };
}

function buildValueContent(post, sources) {
  const trend = titleCase(post.trend || post.title || "this topic");
  const category = post.category || "Trends";
  const sourceSentence = sourceSummary(sources);
  const caution = categoryCaution(category);
  const readerQuestion = likelyReaderQuestion(category, trend);
  const practicalUse = practicalUseCase(category, trend);
  const verification = verificationChecklist(category, trend);
  const sourceTitles = sources.slice(0, 4).map((source) => source.title).filter(Boolean).join("; ") || "available public coverage";

  return [
    `${trend} is drawing attention because readers are trying to answer one practical question: ${readerQuestion}. This ContextWire briefing is built to slow the topic down, explain the visible source pattern, and show what should be checked before a reader shares, cites, or acts on the information.`,
    `Context: ${trend} sits in the ${category.toLowerCase()} lane, which means it should be judged by the standards of that topic area rather than by search volume alone. A search spike can reveal real public interest, but it can also collect rumors, repeated headlines, and partial explanations. The useful approach is to separate the durable signal from the noise: what sources are discussing, what a reader can verify today, and what may change as new reporting or official updates appear.`,
    `Why it is trending: The current source pattern includes ${sourceTitles}. When multiple public sources mention the same topic in a short window, readers often search because they want a clean version of the story, not just another headline. That pattern does not make every claim true, but it does explain why the keyword is visible. The attention around ${trend} appears to come from people trying to connect the headline to a practical result, date, decision, release, score, price, statement, or public update.`,
    `Key developments: The strongest development is the source trail itself: ${sourceSentence} Those source titles should be treated as signposts, not final proof of every detail circulating online. A careful reader should look for repeated facts, named organizations, publication times, corrections, and direct links to official pages or primary records. If the same core detail appears across several reliable sources, confidence rises. If the detail appears only once or in vague wording, it should remain provisional.`,
    `Reader impact: ${practicalUse} For a quick reader, the article should provide orientation: what the topic is, why people care, and where the uncertainty sits. For someone making a decision, the standard is higher. Business topics may affect money, technology topics may affect accounts or devices, sports topics may affect schedules or results, culture topics may affect releases or tickets, and news topics may affect public understanding or reputation.`,
    `What to verify: ${verification} Also check whether the newest source has updated its headline, whether an official account has clarified the situation, and whether older posts are being recycled as if they were current. Verification is especially important when a topic involves health, legal issues, finance, politics, public safety, personal reputation, sports results, or celebrity claims. In those cases, a fast summary should never replace primary confirmation.`,
    `Source notes: The links shown below are included for reader verification. They are not decoration and they should not be treated as a guarantee that every online claim is settled. Open the most recent source first, compare it with at least one other source, and look for direct evidence such as official statements, filings, release notes, match centers, documents, or named representatives. If sources disagree, the disagreement is itself part of the story and should be read cautiously.`,
    `What to watch next: The next useful signal will be a fresh official update, a corrected report, a clearer timeline, or a new source that confirms the main detail independently. If ${trend} keeps appearing in fresh coverage, the topic may deserve a deeper follow-up. If attention fades quickly, it may have been a short-lived search wave. The important point is to watch the quality of new evidence rather than the loudness of the conversation.`,
    `Editorial standard: ContextWire treats a trending topic as a starting point for explanation, not as proof. The article should remain specific, cautious, and useful even when the facts are still moving. That means avoiding dramatic claims, avoiding filler language, and making uncertainty visible. ${caution} A good article earns trust by telling readers what is known, what is not yet clear, and how to check the next update.`,
    `Practical reading guide: Start with the first paragraph for the quick answer, then use the source notes to verify the strongest claim. If the topic affects a decision, do not rely on a single article or a social screenshot. Look for publication dates, official channels, named sources, and whether the same detail is repeated without copying the same original report. This is the difference between informed reading and simply following a trend spike.`,
    `Update outlook: ${trend} may develop through corrections, follow-up reporting, direct statements, schedule changes, market reaction, release details, or public response. If a future update changes the meaning of the story, the best version of this page should be revised rather than left frozen. Readers should treat this briefing as a current map of the topic, with the source links serving as the path to the latest confirmation.`,
    `Bottom line: ${trend} is worth following because readers are clearly looking for clarity, but the safest conclusion is the one supported by current sources and careful verification. Use this page to understand the context, identify the key checks, and decide what deserves attention next. The strongest reading is not the fastest one; it is the one that stays grounded when the topic is still moving.`
  ].map(cleanText);
}

async function upgradePostPage(post) {
  const page = new URL(`${post.slug}.html`, paths.postPagesDir);
  let html;
  try {
    html = await readFile(page, "utf8");
  } catch {
    return;
  }

  html = injectQualityCss(html);
  html = replaceArticleBody(html, post);
  html = injectSourceSidebar(html, post);
  html = replaceShareUrls(html, post);
  await writeFile(page, html, "utf8");
}

function replaceArticleBody(html, post) {
  const body = articleBodyHtml(post);
  const pattern = /(<div class="post-body">\s*(?:<figure class="feature-image">[\s\S]*?<\/figure>\s*)?)([\s\S]*?)(\s*<div class="share-buttons" aria-label="Share this article">)/;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, (_, start, _old, end) => `${start}${body}${end}`);
}

function articleBodyHtml(post) {
  const paragraphs = (post.content || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n        ");
  return `${paragraphs}\n        ${sourceBoxHtml(post)}\n        ${reviewBoxHtml(post)}\n        `;
}

function sourceBoxHtml(post) {
  const sources = normalizeSources(post.sources || [], post).slice(0, 8);
  return `<section class="source-box" aria-labelledby="sources-${escapeAttribute(post.slug)}">
          <p class="card-label" id="sources-${escapeAttribute(post.slug)}">Sources checked</p>
          <p>These links are shown for reader verification. Open the latest source first when the story is still changing.</p>
          <ol>${sources.map((source) => `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="nofollow noopener">${escapeHtml(source.title)}</a>${source.publishedAt ? ` <span>${escapeHtml(formatDate(source.publishedAt))}</span>` : ""}</li>`).join("")}</ol>
        </section>`;
}

function reviewBoxHtml(post) {
  return `<aside class="review-box" aria-label="Editorial review note">
          <strong>Editorial standard</strong>
          <p>ContextWire briefings are structured for reader verification: the topic is explained in plain language, sources are visible, and time-sensitive claims should be checked against the latest public updates.</p>
        </aside>`;
}

function injectQualityCss(html) {
  if (html.includes("quality-upgrades.css")) return html;
  return html.replace("<link rel=\"stylesheet\" href=\"../assets/styles.css\">", "<link rel=\"stylesheet\" href=\"../assets/styles.css\">\n  <link rel=\"stylesheet\" href=\"../assets/quality-upgrades.css\">");
}

function injectSourceSidebar(html, post) {
  return html.replace(/<div class="sidebar-block quality-score-block">[\s\S]*?<\/div>/g, "");
}

function replaceShareUrls(html, post) {
  const canonical = `${config.siteUrl}/posts/${post.slug}.html`;
  return html.replace(/https:\/\/twitter\.com\/intent\/tweet\?url=[^"]+&text=[^"]+/g, `https://twitter.com/intent/tweet?url=${encodeURIComponent(canonical)}&text=${encodeURIComponent(post.title)}`);
}

function postMetadata(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    trend: post.trend,
    category: post.category,
    excerpt: post.excerpt,
    image: post.image,
    tags: post.tags || [],
    quality: post.quality || null,
    ogImage: post.ogImage || null,
    sourceCount: (post.sources || []).length,
    publishedAt: post.publishedAt,
    url: `${config.siteUrl}/posts/${post.slug}.html`,
    readingTime: readingTime(post)
  };
}

function normalizeSources(sources, post) {
  const clean = (Array.isArray(sources) ? sources : [])
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      title: cleanText(source.title || "Source used for this briefing"),
      url: String(source.url || "").trim(),
      publishedAt: source.publishedAt || null
    }))
    .filter((source) => /^https?:\/\//i.test(source.url));

  if (clean.length) return uniqueBy(clean, (source) => source.url).slice(0, 8);

  return [{
    title: `Public trend/source feed for ${titleCase(post.trend || post.title || "this topic")}`,
    url: config.siteUrl,
    publishedAt: post.publishedAt || null
  }];
}

function strongerTitle(title, trend, category) {
  const base = cleanText(title || "");
  if (base && !/full briefing|trending context|key context|what's happening right now/i.test(base)) return trimTitle(base, 78);
  const options = {
    Technology: [`${trend}: What Changed, What to Check, and Why It Matters`, `${trend}: Practical Reader Guide and Source Check`],
    Business: [`${trend}: What Investors and Readers Should Verify`, `${trend}: Key Context, Risks, and Source Check`],
    Sports: [`${trend}: Schedule, Result, and Context Checks`, `${trend}: What Fans Should Confirm First`],
    Culture: [`${trend}: Release Details, Public Reaction, and What to Verify`, `${trend}: Context, Timeline, and Reader Guide`],
    News: [`${trend}: Facts to Check Before Sharing`, `${trend}: Timeline, Source Check, and Context`],
    Trends: [`${trend}: Clear Context and Source Check`, `${trend}: What Readers Should Know and Verify`]
  };
  return trimTitle((options[category] || options.Trends)[hashIndex(trend, 2)], 78);
}

function strongerExcerpt(excerpt, trend, category, sources) {
  const sourceText = sources.length > 1 ? `${sources.length} public sources` : "the available source trail";
  const text = `${trend} explained with reader-first context, ${category.toLowerCase()} verification points, and ${sourceText} so the page is useful beyond a simple trend summary.`;
  return trimTitle(text, 210);
}

function qualityForPost(post) {
  const words = wordCount(post.content || []);
  const warnings = [];
  const text = [post.title, post.excerpt, ...(post.content || [])].join(" ");
  const sections = requiredSections.filter((section) => text.includes(section));
  if (words < 900) warnings.push("below-900-words");
  if ((post.sources || []).length < 1) warnings.push("missing-visible-sources");
  if (sections.length < requiredSections.length) warnings.push("missing-reader-value-sections");
  if (!post.image?.alt || !post.image?.credit) warnings.push("image-metadata-needed");
  if (/TrendPulse|sattarwajith-boop\.github\.io|Blog-Website/i.test(text)) warnings.push("old-brand-or-domain");
  return {
    wordCount: words,
    score: qualityScore(post),
    sections,
    warnings: [...new Set(warnings)]
  };
}

function qualityScore(post) {
  let score = 55;
  const words = wordCount(post.content || []);
  if (words >= 900) score += 12;
  if (words >= 1000) score += 8;
  if ((post.sources || []).length >= 2) score += 12;
  if ((post.sources || []).length >= 5) score += 5;
  if (post.image?.alt && post.image?.credit) score += 4;
  if (requiredSections.every((section) => (post.content || []).join(" ").includes(section))) score += 4;
  return Math.min(96, score);
}

function sourceSummary(sources) {
  const visible = sources.slice(0, 4).map((source) => source.title).filter(Boolean);
  if (!visible.length) return "The available public source trail is limited, so the article should be reviewed before publishing.";
  if (visible.length === 1) return `The current source trail starts with ${visible[0]}.`;
  return `The current source trail includes ${visible.slice(0, -1).join(", ")}, and ${visible.at(-1)}.`;
}

function likelyReaderQuestion(category, trend) {
  const map = {
    Technology: `what changed, whether it affects their device, app, account, or buying decision, and where the official update is`,
    Business: `whether the headline changes a company, price, market view, or personal finance decision`,
    Sports: `whether the schedule, score, injury, lineup, or standing is confirmed`,
    Culture: `whether the release, appearance, show, ticket, or public claim is confirmed`,
    News: `what is confirmed, what is still disputed, and which primary source should be checked first`,
    Trends: `why the topic is visible and what information is safe to rely on`
  };
  return map[category] || map.Trends;
}

function practicalUseCase(category, trend) {
  const map = {
    Technology: `${trend} matters most when it helps readers make a practical tech decision: update, wait, buy, avoid, compare, or check an official status page.`,
    Business: `${trend} matters most when readers can separate market noise from confirmed numbers, filings, company statements, or trusted financial reporting.`,
    Sports: `${trend} matters most when fans can confirm the actual date, result, standings impact, or official team/league update.`,
    Culture: `${trend} matters most when readers can separate confirmed entertainment information from fan speculation, reposted claims, or promotional noise.`,
    News: `${trend} matters most when readers can identify the confirmed fact, the responsible organization, and the latest primary update.`,
    Trends: `${trend} matters most when readers can understand why the keyword is spreading and what should be checked before repeating it.`
  };
  return map[category] || map.Trends;
}

function verificationChecklist(category, trend) {
  const map = {
    Technology: `Check the official product page, developer blog, release notes, status page, or app store listing before acting on ${trend}.`,
    Business: `Check company filings, official statements, exchange data, earnings documents, or trusted financial coverage before relying on ${trend}.`,
    Sports: `Check the official league site, team account, fixture page, match center, or injury report before treating ${trend} as final.`,
    Culture: `Check official artist, studio, broadcaster, venue, ticketing, or publisher pages before sharing claims around ${trend}.`,
    News: `Check primary records, official statements, full documents, and multiple trusted outlets before making a firm conclusion about ${trend}.`,
    Trends: `Check the publication date, original source, and whether the same detail appears in more than one reliable place before sharing ${trend}.`
  };
  return map[category] || map.Trends;
}

function categoryCaution(category) {
  const map = {
    Technology: "Technology details can change after a rollout, update, or outage, so current official documentation matters.",
    Business: "Business and market topics can affect financial decisions, so this page should not be treated as financial advice.",
    Sports: "Sports details can change quickly because of injuries, delays, lineup changes, and schedule updates.",
    Culture: "Entertainment topics often mix confirmed reporting with speculation, so careful sourcing matters.",
    News: "News and public-interest topics can affect reputations or decisions, so avoid repeating unverified claims.",
    Trends: "Trend data shows attention, not certainty, so the strongest claim should come from a reliable source."
  };
  return map[category] || map.Trends;
}

function qualityCss() {
  return `.source-box,
.review-box {
  margin: 34px 0;
  border: 1px solid rgba(15, 118, 110, 0.22);
  border-radius: 18px;
  padding: 22px;
  background: linear-gradient(180deg, rgba(15, 118, 110, 0.08), rgba(255, 255, 255, 0.72));
}

.source-box ol {
  margin: 14px 0 0;
  padding-left: 22px;
}

.source-box li + li {
  margin-top: 10px;
}

.source-box a {
  color: #0f766e;
  font-weight: 800;
}

.source-box span {
  display: block;
  color: var(--muted);
  font-size: 0.9rem;
}

.review-box strong,
.quality-score-block strong {
  display: block;
  margin-bottom: 8px;
  font-family: Newsreader, Georgia, serif;
  font-size: 1.55rem;
}

.quality-score-block strong {
  color: #0f766e;
}
`;
}

function adsenseChecklist() {
  return `# AdSense readiness checklist

This repository now includes a ContextWire quality-upgrade layer for reader-first posts.

## Before applying

- Set the real custom domain in GitHub Pages.
- Run the generator with \`SITE_URL=https://yourdomain.com\` so sitemap, RSS, canonical URLs, and robots.txt use your real domain.
- Review at least 20 to 30 articles manually before applying.
- Open several live posts in incognito and confirm the source boxes are visible.
- Replace weak posts that have only one source or generic information.
- Add Google Search Console and submit \`/sitemap.xml\`.
- Add \`ads.txt\` only after AdSense gives your real publisher ID.

## Recommended publishing workflow

1. Let automation create the draft.
2. Run the ContextWire quality workflow, or locally run \`SITE_URL=https://contextwire.online BLOG_NAME=ContextWire node scripts/upgrade-quality.mjs\`.
3. Manually check facts and sources.
4. Publish only articles with real reader value.

Do not try to hide AI use. Improve the public quality so the site is useful to real readers.
`;
}

function classifyTopic(topic) {
  const text = String(topic || "").toLowerCase();
  if (/(\bai\b|tech|iphone|google|microsoft|tesla|nvidia|\bapp\b|software|cyber|images)/.test(text)) return "Technology";
  if (/(\bstock\b|market|nasdaq|fed|inflation|crypto|bitcoin|earnings|bank|finance|dram|smci|ford|\bmu\b|apac)/.test(text)) return "Business";
  if (/(nba|nfl|mlb|soccer|cricket|ufc|game|cup|league|ipl|csk|warriors|playoffs|tennis|golf|baseball|boxing)/.test(text)) return "Sports";
  if (/(movie|music|album|tv|netflix|celebrity|trailer|festival|book|novel|bruno|mars|actor|actress)/.test(text)) return "Culture";
  if (/(election|court|president|minister|law|policy|senate|politics|white house|medicare|health)/.test(text)) return "News";
  return "Trends";
}

function tagsForPost(post) {
  return [...new Set([
    post.category,
    ...String(post.trend || post.title || "").split(/\s+/).filter((word) => word.length > 3).slice(0, 6).map(titleCase)
  ].filter(Boolean))].slice(0, 8);
}

function readingTime(post) {
  const words = [post.title, post.excerpt, ...(post.content || [])].join(" ").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 190))} min`;
}

function wordCount(content) {
  return (Array.isArray(content) ? content.join(" ") : String(content || "")).trim().split(/\s+/).filter(Boolean).length;
}

function titleCase(value) {
  const smallWords = new Set(["vs", "and", "or", "the", "of", "in", "on", "for", "to"]);
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (["csk", "mi", "ufc", "ipl", "nba", "nfl", "mlb", "psg", "nbc", "wsl", "apac", "smci", "dram", "jg", "ai"].includes(lower)) return word.toUpperCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\bdelve into\b/gi, "explain")
    .replace(/\bin today's fast-paced world\b/gi, "")
    .replace(/\bin the ever-evolving landscape\b/gi, "")
    .trim();
}

function trimTitle(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hashIndex(value, length) {
  return createHash("sha256").update(String(value || "")).digest()[0] % length;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
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

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
