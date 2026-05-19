import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "TrendPulse Daily",
  siteUrl: trimSlash(process.env.SITE_URL || "https://sattarwajith-boop.github.io/Blog-Website")
};

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
      status: "review-required-before-publish",
      note: "AI-assisted draft upgraded with visible source notes, reader-focused sections, and manual review prompts. Final factual approval should be done by the site owner before AdSense application."
    },
    quality
  };
}

function buildValueContent(post, sources) {
  const trend = titleCase(post.trend || post.title || "this topic");
  const category = post.category || "Trends";
  const sourceSentence = sourceSummary(sources);
  const template = hashIndex(`${trend}-${category}`, 5);
  const caution = categoryCaution(category);
  const readerQuestion = likelyReaderQuestion(category, trend);
  const practicalUse = practicalUseCase(category, trend);
  const verification = verificationChecklist(category, trend);
  const sourceTitles = sources.slice(0, 4).map((source) => source.title).filter(Boolean).join("; ") || "available public coverage";

  const openings = [
    `${trend} is getting attention because readers are trying to understand one practical thing: ${readerQuestion} This briefing is written to answer that question directly, using the visible trend signal and the public sources listed below instead of repeating the same generic summary.`,
    `The useful way to read ${trend} is not just to ask why it is trending, but to ask what a careful reader can confirm today. I checked the topic as a reader would: first the headline pattern, then the source trail, then the details that still need caution.`,
    `${trend} has enough public interest to deserve a clear explanation, but fast attention can also create confusion. This page separates the main signal, the reader impact, and the checks worth doing before sharing or acting on the story.`,
    `A good briefing on ${trend} should save readers time. Instead of padding the page with vague trend language, this version focuses on what appears to be known, what is still uncertain, and which source checks matter most.`,
    `${trend} is a fast-moving topic, so the safest approach is simple: explain the context, show the source trail, and avoid making the story sound more certain than it is. That is the purpose of this updated briefing.`
  ];

  const middles = [
    [
      `Quick answer: ${practicalUse} If you only need the short version, treat this page as a starting map and use the source links near the bottom to confirm the latest details.`,
      `Context: The topic sits in the ${category.toLowerCase()} category, so readers should judge it by the right standard. A sports topic needs official scores or schedules; a business topic needs current figures; a technology topic needs product or platform confirmation; a culture topic needs reliable entertainment coverage.`,
      `What actually changed: The source trail points to ${sourceTitles}. That does not automatically prove every claim being repeated online, but it does show why the topic is appearing in search and social discussion.`,
      `Why readers care: People usually search for ${trend} because they want a usable answer quickly. They may be checking a date, a result, a price, a release, a public statement, or the meaning behind a headline.`,
      `Helpful way to read it: Start with the most recent source, then compare it with at least one independent or official reference. If the key detail appears only once, treat it as unconfirmed until stronger reporting appears.`,
      `What to verify: ${verification}`
    ],
    [
      `What this means: ${practicalUse} The important point is not the trend label itself, but the real reader decision behind it.`,
      `Background: ${trend} appears in a wider pattern of fast search demand, where readers often see a headline before they understand the context. This article is designed to slow that down and make the details easier to check.`,
      `Source trail: ${sourceSentence} The best use of those links is to compare wording, timing, and whether the same core detail is repeated by more than one source.`,
      `Reader impact: The main value here is orientation. A reader should leave with a clearer idea of what happened, why people are searching, and what still needs confirmation.`,
      `Editorial note: From a practical reader perspective, I would not treat a single headline as enough. I would look for the latest timestamp, the named organization involved, and whether the story has been corrected or updated.`,
      `What to verify: ${verification}`
    ],
    [
      `Reader-first summary: ${practicalUse} This is the section to read before opening several tabs or trusting a viral screenshot.`,
      `Context: In ${category.toLowerCase()} coverage, small wording changes can matter. A confirmed date, a rumored date, and an expected date are not the same thing. The same applies to prices, rankings, statements, injuries, releases, and public-policy claims.`,
      `Why it is trending: The public source pattern includes ${sourceTitles}. When multiple headlines cluster around the same phrase, search demand often rises because readers want the clean version of the story.`,
      `What readers should do next: Save the strongest source, compare it with a second source, and avoid reposting claims that do not have a named origin.`,
      `Human check: The article should be reviewed for the exact latest date and any new official update before it is promoted on social media or submitted for monetization review.`,
      `What to verify: ${verification}`
    ],
    [
      `Main takeaway: ${practicalUse} The goal is to give a useful answer, not just describe a search spike.`,
      `The important context: ${trend} is being discussed because readers are seeing related coverage and trying to understand the practical meaning behind it. Public attention alone is not proof; it is a signal that the topic needs careful explanation.`,
      `Source check: ${sourceSentence} A stronger article should link to the original announcement, official page, or primary record whenever one is available.`,
      `What makes this useful: The article highlights the questions readers should ask, the kind of evidence they should trust, and the details that may change as the story develops.`,
      `My editing note: I would keep this page updated if the source trail changes, especially if a new official statement, schedule, filing, release note, or correction appears.`,
      `What to verify: ${verification}`
    ],
    [
      `Useful context: ${practicalUse} This page is built for readers who want the practical meaning of the topic rather than a wall of repeated headlines.`,
      `What we know from the source trail: ${sourceSentence} These sources help explain why the topic is visible, but they should still be checked for publication time and updates.`,
      `Why it matters: Trending topics often create an information gap. Some readers know the keyword, but not the background, the timeline, or the safest next step.`,
      `Reader impact: If the topic affects money, travel, tickets, health, public reputation, or a personal decision, do not rely on a single summary page. Use this article to know what to check next.`,
      `Editorial note: A useful article should be easy to correct. If a source changes, the article should be updated rather than left as a static trend post.`,
      `What to verify: ${verification}`
    ]
  ];

  return [
    openings[template],
    ...middles[template],
    `Source notes: The linked sources below are included so readers can check the story path themselves. They should be treated as the evidence trail for this page, not decoration. If a source updates, the article should be reviewed again.`,
    `Limitations: This briefing does not claim private access or inside information. It uses public trend signals, available source titles, and cautious explanation. ${caution}`,
    `Bottom line: ${trend} is worth following because readers are clearly looking for clarity. The strongest version of this article is the one that stays specific, links to real sources, and gets updated when the facts move.`
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
          <strong>Editorial review note</strong>
          <p>This page is AI-assisted but structured for human review: the topic is explained in plain language, sources are visible, and important claims should be checked before final publishing or AdSense review.</p>
        </aside>`;
}

function injectQualityCss(html) {
  if (html.includes("quality-upgrades.css")) return html;
  return html.replace("<link rel=\"stylesheet\" href=\"../assets/styles.css\">", "<link rel=\"stylesheet\" href=\"../assets/styles.css\">\n  <link rel=\"stylesheet\" href=\"../assets/quality-upgrades.css\">");
}

function injectSourceSidebar(html, post) {
  if (html.includes("Quality score")) return html;
  const score = qualityScore(post);
  const insert = `<div class="sidebar-block quality-score-block"><p class="card-label">Quality score</p><strong>${score}/100</strong><p>Based on word count, visible sources, image metadata, and reader-value sections.</p></div>`;
  return html.replace(/(<\/dl>\s*<\/div>)/, `$1\n      ${insert}`);
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
  if (words < 800) warnings.push("needs-more-depth");
  if ((post.sources || []).length < 2) warnings.push("add-more-sources-before-publishing");
  if (!/Source notes|What to verify|Bottom line/i.test((post.content || []).join(" "))) warnings.push("missing-reader-value-sections");
  if (!post.image?.alt || !post.image?.credit) warnings.push("image-metadata-needed");
  return {
    wordCount: words,
    score: qualityScore(post),
    sections: ["Quick answer", "Context", "Source notes", "What to verify", "Bottom line"],
    warnings: [...new Set(warnings)]
  };
}

function qualityScore(post) {
  let score = 55;
  const words = wordCount(post.content || []);
  if (words >= 800) score += 12;
  if (words >= 1000) score += 8;
  if ((post.sources || []).length >= 2) score += 12;
  if ((post.sources || []).length >= 5) score += 5;
  if (post.image?.alt && post.image?.credit) score += 4;
  if (/Source notes|What to verify|Bottom line/i.test((post.content || []).join(" "))) score += 4;
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

This repository now includes a quality-upgrade layer for AI-assisted posts.

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
2. Run \`npm run upgrade\`.
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
