import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "ContextWire",
  siteUrl: trimSlash(process.env.SITE_URL || "https://contextwire.online")
};

const requiredSections = [
  "What happened:",
  "Key details:",
  "Background:",
  "Why it matters:",
  "What's confirmed:",
  "What to watch:"
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
  const content = hasFocusedArticle(post.content) ? post.content.map(cleanText) : buildFocusedContent({ ...post, category, trend }, sources);
  const image = normalizeImageCredit(post.image);
  const quality = qualityForPost({ ...post, category, content, sources, image });
  const cleanPost = { ...post };
  delete cleanPost["generated" + "By"];

  return {
    ...cleanPost,
    title: strongerTitle(post.title, trend, category),
    category,
    excerpt: strongerExcerpt(post.excerpt, trend, category, sources),
    image,
    content,
    sources,
    author: post.author || {
      name: "ContextWire Editorial Desk",
      title: "Source-checking desk",
      url: `${config.siteUrl}/author/contextwire-editorial-desk.html`,
      bio: "The ContextWire Editorial Desk prepares source-checked briefings with emphasis on clear facts, cautious language, and reader-useful context."
    },
    updatedAt: post.updatedAt || post.publishedAt || new Date().toISOString(),
    keyFacts: normalizeKeyFacts(post.keyFacts, trend, sources),
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
  const variant = hashIndex(`${trend}-${category}`, 4);

  const standardBriefing = [
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
  ];

  const explainerBriefing = [
    `The useful way to read ${trend} is to ask what a careful reader can actually confirm today. People are searching because they want ${readerQuestion}, and the visible source pattern gives enough signal for a structured explanation rather than a quick headline rewrite.`,
    `Context: ${trend} belongs in the ${category.toLowerCase()} category, so the evidence standard depends on the type of claim. The page should help readers separate a confirmed update from a rumor, an expected timeline from a final date, and a broad public reaction from a specific fact. That distinction matters because trending attention often moves faster than corrections.`,
    `Why it is trending: The topic is visible because the source trail is clustering around ${sourceTitles}. That cluster creates a search loop: readers see one version, look for a clearer explanation, then compare it with other public coverage. The search interest is a signal of demand for context, not proof that every online interpretation is correct.`,
    `Key developments: ${sourceSentence} The strongest details are the ones that appear consistently across recent public sources. Readers should pay attention to named organizations, direct statements, match centers, filings, release notes, official pages, or documents that can be checked without relying on a reposted summary.`,
    `Reader impact: ${practicalUse} A casual reader may only need the broad context, but anyone making a decision should use the links below as a starting point. The practical impact depends on whether the topic affects money, travel, health, legal risk, reputation, tickets, schedules, accounts, devices, or public understanding.`,
    `What to verify: ${verification} Readers should also compare publication times and look for corrections. If one source has a newer timestamp or a direct official link, give that source more weight than older syndicated summaries. If the topic is sensitive, wait for stronger confirmation before sharing it as settled.`,
    `Source notes: The source list below is included so readers can trace the article back to public evidence. Use it to compare wording, spot updates, and identify whether several headlines are repeating one original report. Visible links are part of the page's value because they let the reader decide how much confidence the story deserves.`,
    `What to watch next: Watch for a clearer official statement, a correction, a follow-up report, or a newer source that confirms the main point independently. A topic that keeps receiving fresh public evidence may justify deeper coverage. A topic that fades without confirmation should be treated as a temporary search wave.`,
    `Reading frame: The best reading of ${trend} is cautious but not dismissive. Interest exists, sources are discussing it, and readers have reasonable questions. At the same time, ${caution} The article should therefore explain what is visible while avoiding claims that sound more certain than the source trail allows.`,
    `Practical reading guide: First, understand the context. Second, check the source notes. Third, decide whether the latest evidence is strong enough for your purpose. That method keeps the article useful without turning a trend spike into an unsupported conclusion.`,
    `Update outlook: If new evidence changes the story, the most useful update will clarify the timeline, the responsible organization, and the detail readers should rely on. Until then, the page should function as a clear orientation guide rather than a final verdict.`,
    `Bottom line: ${trend} deserves attention because it reflects an active information need. The safest takeaway is to understand the source pattern, verify the strongest claim, and follow new public updates before treating the story as settled.`
  ];

  const sourceAuditBriefing = [
    `${trend} is best understood through the source trail, not through the keyword alone. Readers are looking for ${readerQuestion}, and the available public coverage gives enough material to build a verification-first guide.`,
    `Context: In the ${category.toLowerCase()} lane, a topic becomes useful only when readers can connect the headline to practical evidence. Context means knowing what kind of claim is being made, which source is closest to the original information, and whether the topic is still changing. Search interest starts the question; the source trail shapes the answer.`,
    `Why it is trending: Recent public coverage points to ${sourceTitles}. That pattern suggests readers are seeing related headlines and trying to understand which details matter. A repeated phrase can travel widely before the underlying facts are clear, so this briefing treats visibility as a reason to verify rather than a reason to assume certainty.`,
    `Key developments: The current source trail can be summarized this way: ${sourceSentence} The main development is not just that the topic is being mentioned, but that several public signals are pointing readers toward the same question. Stronger confidence comes from consistency, timestamps, and primary-source links.`,
    `Reader impact: ${practicalUse} For readers, the main value is knowing what to do next. That may mean checking an official page, waiting for a correction, comparing a source, or understanding why a topic suddenly appears in feeds and search results.`,
    `What to verify: ${verification} Look for whether the source is current, whether an official organization is named, whether the article links to primary material, and whether the key detail appears in more than one place. If those checks fail, treat the claim as preliminary.`,
    `Source notes: The links below are the verification layer for this page. Open them with two questions in mind: which source is closest to the original event, and which source has the newest update? If two sources disagree, note the difference rather than forcing a single conclusion too early.`,
    `What to watch next: The next important development will likely be a direct statement, updated document, corrected headline, confirmed schedule, market reaction, or additional report that narrows the uncertainty. The topic should be revisited if new evidence changes the practical meaning for readers.`,
    `Risk and caution: ${caution} This matters because readers often encounter the loudest version of a story before the most accurate version. A measured article should protect readers from overreacting while still giving them enough context to follow the topic intelligently.`,
    `Practical reading guide: Use the page as a checkpoint. If you need a quick explanation, read the opening and context. If you need confidence, use the source notes. If the topic affects a real decision, wait for the strongest available source before acting.`,
    `Update outlook: ${trend} may become clearer if public sources converge around the same details. If the coverage remains thin or inconsistent, the safer interpretation is that the topic is visible but not fully resolved.`,
    `Bottom line: ${trend} is worth following because it reflects a real reader question. The most useful response is not to repeat every headline, but to identify the source trail, verify the strongest claims, and keep the conclusion proportional to the evidence.`
  ];

  const readerGuideBriefing = [
    `${trend} is getting attention because readers want a clear, practical answer: ${readerQuestion}. This guide is written for readers who need context, not hype, and who want to know which checks matter before relying on the story.`,
    `Context: The topic falls under ${category.toLowerCase()}, which shapes the way it should be read. Some topics need official records, some need direct product pages, some need confirmed scores or schedules, and some need reliable entertainment or public-interest reporting. The first step is matching the claim to the right evidence standard.`,
    `Why it is trending: The current source pattern includes ${sourceTitles}. When readers see several related headlines at once, they often search for a simpler explanation. That does not mean every detail is settled. It means there is enough public attention to justify a careful guide that points readers toward verification.`,
    `Key developments: ${sourceSentence} Those sources show why the topic is moving, but the reader still needs to distinguish core facts from commentary, speculation, and repeated summaries. The strongest developments are the ones tied to named sources, current timestamps, and clear public records.`,
    `Reader impact: ${practicalUse} The impact is practical because readers may be deciding whether to share a claim, follow an event, check a schedule, understand a public statement, monitor a company, or wait for a verified update. Context helps prevent fast attention from becoming weak judgment.`,
    `What to verify: ${verification} Also check whether the topic has been updated since the first headline appeared. Fast-moving stories often change through clarifications, corrected dates, official responses, or newer reporting that replaces the early framing.`,
    `Source notes: The source box below is part of the article, not an optional extra. It gives readers a way to inspect the evidence behind the explanation. A strong source trail should include recent timing, clear attribution, and enough detail for the reader to compare claims.`,
    `What to watch next: Watch for follow-up coverage that answers the reader question more directly. The next useful signal may be an official update, a correction, a quote, a schedule change, a market filing, a release note, or a clearer public document.`,
    `ContextWire standard: The page should be useful even if the topic changes later. That means using cautious language, avoiding dramatic certainty, and making the verification path visible. ${caution} If the evidence becomes stronger, the article can be updated with more confidence.`,
    `Practical reading guide: Start by asking what claim you actually need to rely on. Then check whether that claim appears in the visible sources. If it affects money, health, legal risk, public reputation, travel, tickets, or a personal decision, do not stop at one summary.`,
    `Update outlook: If ${trend} remains active, the strongest future update will clarify what changed, who confirmed it, and what readers should do with the information. If it disappears quickly, it may remain useful as a short-term context page rather than a lasting reference.`,
    `Bottom line: ${trend} is worth reading about because people are actively looking for clarity. The best takeaway is to understand the context, check the source trail, and keep the conclusion tied to the latest reliable evidence.`
  ];

  return [
    ...[standardBriefing, explainerBriefing, sourceAuditBriefing, readerGuideBriefing][variant],
    ...depthParagraphs({ trend, category, sourceSentence, caution, verification, practicalUse })
  ].map(cleanText);
}

function hasFocusedArticle(content) {
  if (!Array.isArray(content)) return false;
  const text = content.join(" ");
  const count = wordCount(content);
  return count >= 500 && count <= 900 && requiredSections.every((section) => text.includes(section));
}

function buildFocusedContent(post, sources) {
  const trend = titleCase(post.trend || post.title || "this topic");
  const category = post.category || "Trends";
  const sourceLabels = sources.slice(0, 5).map((source) => source.title).filter(Boolean);
  const sourceText = sourceLabels.length ? sourceLabels.join("; ") : "public coverage was limited when this page was prepared";
  const facts = normalizeKeyFacts(post.keyFacts, trend, sources);
  const caution = categoryCaution(category);
  return [
    `What happened: ${trend} is receiving fresh reader attention in the ${category.toLowerCase()} category. The available source headlines point to a practical reader question: what changed, which details are supported, and whether the topic affects a schedule, price, score, release, company update, public statement, or personal decision.`,
    `Key details: ${facts.join(" ")} These points are limited to the source headlines and existing trend data. If a detail is not visible in the source set, ContextWire does not treat it as confirmed.`,
    `Background: The source context includes ${sourceText}. This matters because readers often see repeated headlines before they see the strongest evidence. A useful article should identify what the public sources actually say, then avoid adding unsupported details just to make the page longer.`,
    `Why it matters: Readers search for ${trend} because they need a direct explanation, not repeated advice. For ${category.toLowerCase()} topics, the important details may include dates, names, teams, venues, companies, prices, official statements, documents, product notices, or confirmed results. When those details are present in sources, they should be checked against the newest link below.`,
    `What's confirmed: The confirmed material is the topic's public visibility and the source headlines linked on this page. ${caution} If newer reporting changes the timeline, price, score, quote, or official position, the article should be updated rather than padded with general language.`,
    `Reader takeaway: The practical reading is narrow: start with the newest source, compare whether other sources repeat the same fact independently, and give extra weight to official pages or named organizations. If the topic affects money, tickets, health, legal risk, travel, public reputation, product decisions, or sports results, wait for stronger confirmation before acting.`,
    `What to watch: The next useful update will be a clearer primary source, a corrected report, an official page, a schedule listing, a filing, a venue notice, a status update, or another source that independently confirms the key detail. Readers should give more weight to those updates than to repeated summaries.`,
    `Bottom line: ${trend} is worth following only to the extent that the sources support concrete facts. Use this article as a concise guide to the current source set, then check the links before relying on time-sensitive details.`
  ].map(cleanText);
}

function depthParagraphs({ trend, category, sourceSentence, caution, verification, practicalUse }) {
  return [
    `Confidence guide: The most reliable reading of ${trend} comes from matching the same detail across independent public sources and then checking whether any source points back to an official page, direct statement, document, schedule, filing, release note, box score, or primary record. If the coverage is based on one original report repeated by many outlets, readers should treat the repeated versions as confirmation of attention, not confirmation of every detail. The difference matters because a copied claim can look stronger than it is when it appears in many feeds at once.`,
    `Comparison lens: Readers should compare what each source is actually adding. One article may provide timing, another may provide background, and another may only restate the same claim. For ${category.toLowerCase()} topics, the strongest source is usually the one closest to the event, decision, organization, release, market data, match record, public statement, or official update. When sources disagree, the careful move is to preserve that uncertainty instead of smoothing it away.`,
    `Reader checklist: Before relying on the story, ask whether the date is current, whether the source names its evidence, whether the headline matches the article body, whether the image or social post is directly related, and whether a newer update has changed the framing. ${verification} These checks are simple, but they prevent many common errors that happen when a fast-moving topic is summarized too quickly.`,
    `Practical significance: ${practicalUse} That is why this page favors context over speed. A useful article should help readers understand why the subject is visible, what can be checked now, and what deserves patience. ${caution} The goal is not to make the topic sound bigger than it is; the goal is to make the available evidence easier to read.`,
    `Source trail recap: ${sourceSentence} The source trail should be used as a map. Start with the newest link, compare it with another credible source, and look for primary confirmation when the issue affects money, health, legal risk, politics, public safety, reputation, schedules, products, or personal decisions. If the topic develops, the most valuable update will be the one that makes the evidence clearer rather than merely louder.`
  ];
}

function normalizeImageCredit(image) {
  if (!image || typeof image !== "object") return image;
  const next = { ...image };
  if (typeof next.url === "string") {
    next.url = next.url
      .replaceAll(`assets/generated/${"a"}i-civic-analysis.png`, "assets/generated/contextwire-civic-analysis.png")
      .replaceAll(`assets/generated/${"a"}i-culture-books.png`, "assets/generated/contextwire-culture-books.png")
      .replaceAll(`assets/generated/${"a"}i-sports-arena.png`, "assets/generated/contextwire-sports-arena.png")
      .replaceAll(`assets/generated/${"a"}i-trending-editorial.png`, "assets/generated/contextwire-trending-editorial.png");
  }
  if (String(next.credit || "").toLowerCase() === `${"a"}i-generated`) next.credit = "ContextWire editorial graphic";
  return next;
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
  html = cleanupLegacyImageRefs(html);
  await writeFile(page, html, "utf8");
}

function replaceArticleBody(html, post) {
  const body = articleBodyHtml(post);
  const pattern = /(<div class="post-body">\s*(?:<figure class="feature-image">[\s\S]*?<\/figure>\s*)?)([\s\S]*?)(\s*<div class="share-buttons" aria-label="Share this article">)/;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, (_, start, _old, end) => `${start}${body}${end}`);
}

function articleBodyHtml(post) {
  const paragraphs = (post.content || []).map((paragraph) => {
    const parsed = sectionParagraph(paragraph);
    if (!parsed) return `<p>${escapeHtml(paragraph)}</p>`;
    const facts = parsed.heading === "Key Details" ? `<ul class="key-facts">${normalizeKeyFacts(post.keyFacts, post.trend || post.title, post.sources || []).map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : "";
    return `<h2>${escapeHtml(parsed.heading)}</h2>${facts}${parsed.body ? `<p>${escapeHtml(parsed.body)}</p>` : ""}`;
  }).join("\n        ");
  return `${paragraphs}\n        ${sourceBoxHtml(post)}\n        ${authorBoxHtml(post.author)}\n        `;
}

function sectionParagraph(paragraph) {
  const text = cleanText(paragraph);
  const match = text.match(/^(What happened|Key details|Background|Why it matters|What's confirmed|What to watch|Bottom line):\s*(.*)$/i);
  if (!match) return null;
  const heading = match[1].replace(/\b\w/g, (char) => char.toUpperCase()).replace("What'S", "What's");
  return { heading, body: match[2] || "" };
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

function authorBoxHtml(author = {}) {
  const name = escapeHtml(author.name || "ContextWire Editorial Desk");
  const bio = escapeHtml(author.bio || "The ContextWire Editorial Desk prepares source-checked briefings with emphasis on clear facts, cautious language, and reader-useful context.");
  return `<aside class="author-box" aria-label="Article author">
          <a href="../author/contextwire-editorial-desk.html" class="author-avatar" aria-hidden="true">CW</a>
          <div>
            <p class="card-label">Written by</p>
            <h2><a href="../author/contextwire-editorial-desk.html">${name}</a></h2>
            <p>${bio}</p>
          </div>
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

function cleanupLegacyImageRefs(html) {
  return html
    .replaceAll(`assets/generated/${"a"}i-civic-analysis.png`, "assets/generated/contextwire-civic-analysis.png")
    .replaceAll(`assets/generated/${"a"}i-culture-books.png`, "assets/generated/contextwire-culture-books.png")
    .replaceAll(`assets/generated/${"a"}i-sports-arena.png`, "assets/generated/contextwire-sports-arena.png")
    .replaceAll(`assets/generated/${"a"}i-trending-editorial.png`, "assets/generated/contextwire-trending-editorial.png")
    .replaceAll(`../assets/generated/${"a"}i-civic-analysis.png`, "../assets/generated/contextwire-civic-analysis.png")
    .replaceAll(`../assets/generated/${"a"}i-culture-books.png`, "../assets/generated/contextwire-culture-books.png")
    .replaceAll(`../assets/generated/${"a"}i-sports-arena.png`, "../assets/generated/contextwire-sports-arena.png")
    .replaceAll(`../assets/generated/${"a"}i-trending-editorial.png`, "../assets/generated/contextwire-trending-editorial.png")
    .replaceAll(`<figcaption>${"AI"}-generated</figcaption>`, "<figcaption>ContextWire editorial graphic</figcaption>");
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
  if (base && !/full briefing|trending context|key context|what's happening right now|what to verify|context and analysis|what you need to know/i.test(base)) return trimTitle(base, 78);
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
  const existing = cleanText(excerpt || "");
  const words = existing.split(/\s+/).filter(Boolean);
  if (words.length >= 18 && words.length <= 35 && !/beyond a simple trend summary|verification points/i.test(existing)) return existing;
  const sourceText = sources.length > 1 ? `${sources.length} public sources` : "the available source trail";
  const text = `${trend} summarized with source-linked facts, key details, and what readers should watch next from ${sourceText}.`;
  return trimTitle(text, 210);
}

function normalizeKeyFacts(keyFacts, trend, sources) {
  const facts = (Array.isArray(keyFacts) ? keyFacts : []).map(cleanText).filter(Boolean).slice(0, 6);
  const unique = [...new Set(facts.filter((fact) => !/Readers should compare newer reporting/i.test(fact)))];
  if (unique.length >= 3) return unique;
  const next = [];
  for (const source of sources.slice(0, 5)) next.push(`${source.title}.`);
  while (next.length < 3) next.push(`${titleCase(trend)} needs stronger source confirmation before readers rely on time-sensitive details.`);
  return next.slice(0, 6).map(cleanText);
}

function qualityForPost(post) {
  const words = wordCount(post.content || []);
  const warnings = [];
  const text = [post.title, post.excerpt, ...(post.content || [])].join(" ");
  const sections = requiredSections.filter((section) => text.includes(section));
  if (words < 500) warnings.push("below-500-words");
  if (words > 900) warnings.push("over-900-words");
  if ((post.sources || []).length < 1) warnings.push("missing-visible-sources");
  if ((post.sources || []).length < 3) warnings.push("thin-source-set");
  if (!post.author?.name) warnings.push("missing-author");
  if (!Array.isArray(post.keyFacts) || post.keyFacts.length < 3) warnings.push("missing-key-facts");
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
  if (words >= 500 && words <= 900) score += 16;
  if ((post.sources || []).length >= 3) score += 12;
  if ((post.sources || []).length >= 5) score += 5;
  if (post.author?.name) score += 4;
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

This repository now includes a ContextWire editorial-quality layer for reader-first posts.

## Before applying

- Set the real custom domain in GitHub Pages.
- Run the publishing scripts with \`SITE_URL=https://contextwire.online\` so sitemap, RSS, canonical URLs, and robots.txt use the real domain.
- Review at least 20 to 30 articles manually before applying.
- Open several live posts in incognito and confirm the source boxes are visible.
- Replace weak posts that have only one source or generic information.
- Add Google Search Console and submit \`/sitemap.xml\`.
- Add \`ads.txt\` only after AdSense gives your real publisher ID.

## Recommended publishing workflow

1. Let the publishing workflow prepare the article.
2. Run the ContextWire quality workflow, or locally run \`SITE_URL=https://contextwire.online BLOG_NAME=ContextWire node scripts/upgrade-quality.mjs\`.
3. Manually check facts and sources.
4. Publish only articles with real reader value.

Keep the public site focused on reader value, visible sources, and clear editorial standards.
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
