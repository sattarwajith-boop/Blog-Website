import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "ContextWire",
  region: process.env.BLOG_REGION || "US",
  language: process.env.BLOG_LANGUAGE || "en-US",
  postsPerRun: clampNumber(process.env.POSTS_PER_RUN, 1, 10, 1),
  maxPosts: clampNumber(process.env.MAX_POSTS, 20, 500, 160),
  siteUrl: trimSlash(process.env.SITE_URL || "https://contextwire.online"),
  openAiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
};

const paths = {
  posts: new URL("data/posts.json", root),
  index: new URL("data/index.json", root),
  postDataDir: new URL("data/posts/", root),
  postPagesDir: new URL("posts/", root),
  ogDir: new URL("assets/og/", root),
  topics: new URL("data/topics.json", root),
  rss: new URL("rss.xml", root),
  sitemap: new URL("sitemap.xml", root)
};

const bannedPhrases = [
  /delve into/gi,
  /it is worth noting that/gi,
  /it is worth noting/gi,
  /in today'?s fast-paced world/gi,
  /in the ever-evolving landscape/gi,
  /as we can see/gi,
  /this article explores/gi
];

const requiredSections = [
  "What happened:",
  "Key details:",
  "Background:",
  "Why it matters:",
  "What's confirmed:",
  "What to watch:"
];

const defaultAuthor = {
  name: "ContextWire Editorial Desk",
  title: "Source-checking desk",
  url: `${config.siteUrl}/author/contextwire-editorial-desk.html`,
  bio: "The ContextWire Editorial Desk prepares source-checked briefings with emphasis on clear facts, cautious language, and reader-useful context."
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (globalThis.process?.argv?.includes("--backfill")) {
    await backfillExistingPosts();
    return;
  }

  const [posts, usedTopics] = await Promise.all([
    readJson(paths.posts, []),
    readJson(paths.topics, [])
  ]);

  const seenSlugs = new Set(posts.map((post) => post.slug));
  const seenTopics = new Set(usedTopics.map((topic) => topic.key));
  const trends = await fetchTrendingTopics();
  const freshTrends = trends.filter((trend) => !seenTopics.has(trend.key)).slice(0, config.postsPerRun);

  if (freshTrends.length === 0) {
    console.log("No fresh trending topics found.");
    return;
  }

  const generated = [];
  for (const trend of freshTrends) {
    const sources = await fetchNewsSources(trend.title);
    const post = await buildPost(trend, sources);
    if (seenSlugs.has(post.slug)) {
      post.slug = `${post.slug}-${post.id.slice(0, 6)}`;
    }
    seenSlugs.add(post.slug);
    generated.push(post);
  }

  const nextPosts = preparePostCollection([...generated, ...posts].slice(0, config.maxPosts));
  const nextTopics = [
    ...freshTrends.map((trend) => ({ key: trend.key, title: trend.title, usedAt: new Date().toISOString() })),
    ...usedTopics
  ].slice(0, config.maxPosts * 2);

  await writeFile(paths.posts, `${JSON.stringify(nextPosts, null, 2)}\n`, "utf8");
  await writeFile(paths.topics, `${JSON.stringify(nextTopics, null, 2)}\n`, "utf8");
  await writeDerivedSiteFiles(nextPosts);

  console.log(`Published ${generated.length} post(s):`);
  for (const post of generated) console.log(`- ${post.title}`);
}

async function fetchTrendingTopics() {
  const urls = (process.env.TREND_RSS_URLS || `https://trends.google.com/trending/rss?geo=${config.region}`)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const allItems = [];
  for (const url of urls) {
    try {
      const xml = await fetchText(url);
      allItems.push(...parseRss(xml).map((item) => ({
        title: item.title,
        traffic: item.approxTraffic || "",
        sourceUrl: item.link || url,
        publishedAt: item.pubDate || new Date().toUTCString()
      })));
    } catch (error) {
      console.warn(`Trend feed failed: ${url} (${error.message})`);
    }
  }

  const fallback = `https://news.google.com/rss?hl=${config.language}&gl=${config.region}&ceid=${config.region}:${config.language.split("-")[0]}`;
  if (allItems.length === 0) {
    const xml = await fetchText(fallback);
    allItems.push(...parseRss(xml).map((item) => ({
      title: stripPublisher(item.title),
      traffic: "",
      sourceUrl: item.link || fallback,
      publishedAt: item.pubDate || new Date().toUTCString()
    })));
  }

  return uniqueBy(allItems, (item) => topicKey(item.title))
    .filter((item) => item.title && item.title.length > 2)
    .map((item) => ({
      ...item,
      key: topicKey(item.title),
      category: classifyTopic(item.title)
    }));
}

async function fetchNewsSources(topic) {
  const queries = [`"${topic}" when:2d`, `"${topic}"`, topic];
  const collected = [];

  for (const term of queries) {
    const query = encodeURIComponent(term);
    const newsUrl = `https://news.google.com/rss/search?q=${query}&hl=${config.language}&gl=${config.region}&ceid=${config.region}:${config.language.split("-")[0]}`;
    try {
      const xml = await fetchText(newsUrl);
      collected.push(...parseRss(xml).map((item) => ({
        title: stripPublisher(item.title),
        url: item.link,
        publishedAt: item.pubDate || null,
        source: publisherFromTitle(item.title)
      })));
      if (uniqueBy(collected, (item) => item.url || item.title).length >= 5) break;
    } catch (error) {
      console.warn(`News lookup failed for ${topic}: ${error.message}`);
    }
  }

  return uniqueBy(collected, (item) => item.url || item.title)
    .filter((item) => item.title && item.url)
    .slice(0, 5);
}

async function buildPost(trend, sources) {
  const now = new Date().toISOString();
  const id = createHash("sha256").update(`${trend.key}:${now}`).digest("hex").slice(0, 16);
  const base = {
    id,
    slug: slugify(trend.title),
    title: headlineFor(trend.title),
    trend: trend.title,
    category: trend.category,
    excerpt: professionalExcerpt(trend),
    image: imageForPost(trend),
    content: fallbackContent(trend, sources),
    sources: sources.length ? sources : [{ title: "Google Trends topic feed", url: trend.sourceUrl }],
    author: defaultAuthor,
    updatedAt: now,
    keyFacts: keyFactsFor(trend, sources),
    publishedAt: now,
    productionMethod: "editorial-workflow"
  };

  if (!config.openAiKey) return finalizePost(base, trend, sources);

  try {
    const aiPost = await generateWithOpenAI(trend, sources);
    return finalizePost({
      ...base,
      title: aiPost.title || base.title,
      excerpt: aiPost.metaDescription || aiPost.excerpt || base.excerpt,
      image: normalizeImage(aiPost.image, trend),
      content: normalizeAiContent(aiPost, trend, sources),
      keyFacts: Array.isArray(aiPost.keyFacts) && aiPost.keyFacts.length ? aiPost.keyFacts.slice(0, 6).map(cleanGeneratedText) : base.keyFacts
    }, trend, sources);
  } catch (error) {
    console.warn(`OpenAI generation failed for ${trend.title}: ${error.message}`);
    return finalizePost(base, trend, sources);
  }
}

async function generateWithOpenAI(trend, sources) {
  const providedSources = sources.map((source) => ({
    title: source.title,
    publishedAt: source.publishedAt || null,
    url: source.url
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openAiKey}`
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: [
        {
          role: "system",
          content: "You are a factual briefing writer for ContextWire. Write concise source-grounded articles from only the provided trend data and source headlines. Use real specifics from the sources when present: dates, names, venues, teams, companies, prices, scores, releases, and official organizations. Do not invent facts, quotes, prices, dates, scores, or claims. Avoid padding and repeated verification boilerplate. Return strict JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            trend: trend.title,
            category: trend.category,
            approxTraffic: trend.traffic || null,
            headlineContext: providedSources,
            image: imageForPost(trend),
            requiredShape: {
              title: "string under 78 chars",
              metaDescription: "specific summary under 155 chars",
              image: {
                url: "use the supplied image.url exactly",
                alt: "descriptive alt text using the trend title",
                credit: "use the supplied image.credit exactly"
              },
              keyFacts: [
                "3 to 6 concise facts drawn from the source headlines or trend data only"
              ],
              content: [
                "6 to 9 paragraphs totaling 500 to 900 words",
                "First paragraph answers what happened and why the topic matters right now",
                "Include paragraphs starting exactly with: What happened:, Key details:, Background:, Why it matters:, What's confirmed:, What to watch:",
                "Use source names naturally, for example: According to SOURCE NAME...",
                "Every paragraph must add new information; no repeated source-trail or verification filler",
                "If the sources are thin, say exactly what is limited instead of padding"
              ]
            }
          })
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((part) => part.text).join("") || "";
  return JSON.parse(text);
}

function fallbackContent(trend, sources) {
  const cleanTitle = titleCase(trend.title);
  const category = trend.category || classifyTopic(trend.title);
  const cleanSources = normalizeSourcesForPost(sources);
  const headlineNames = cleanSources.slice(0, 5).map(sourceLabel);
  const headlineSummary = headlineNames.length ? headlineNames.join("; ") : "public coverage was limited when this page was prepared";
  const trafficLine = trend.traffic ? `Google Trends reported search interest around ${formatTraffic(trend.traffic)}.` : "The topic appeared in public trend data, but exact search volume was not available.";
  const caution = categoryCaution(category, cleanTitle);
  const keyFacts = keyFactsFor(trend, cleanSources);

  return [
    `What happened: ${cleanTitle} is drawing fresh reader attention in the ${category.toLowerCase()} category. ${trafficLine} The available source headlines point readers toward one practical task: understand the specific update, separate confirmed details from repetition, and decide whether the story affects schedules, money, public understanding, entertainment plans, sport results, or technology decisions.`,
    `Key details: The strongest details currently available from the source set are: ${keyFacts.join(" ")} These points are intentionally limited to what the source headlines and trend data support. If a detail is not visible in the source set, this article does not treat it as confirmed.`,
    `Background: The source context for ${cleanTitle} includes ${headlineSummary}. That mix is useful because it shows which parts of the topic are being repeated publicly and which parts may still need a primary source, official page, direct statement, fixture page, filing, venue notice, product note, or updated report before readers rely on it.`,
    `Why it matters: Readers usually search for a topic like ${cleanTitle} because they need a usable answer, not a pile of repeated headlines. For ${category.toLowerCase()} coverage, that means the article should clarify the latest public signal, identify the responsible organizations or people when the sources name them, and avoid stretching a thin source set into false certainty.`,
    `What's confirmed: The confirmed material is the public trend signal and the linked source headlines shown below. ${caution} When the source set contains dates, names, scores, prices, venues, companies, or official organizations, those details should be checked against the newest linked source before a reader acts on them.`,
    `Reader takeaway: The useful reading is narrow and practical. Start with the newest source, compare whether other sources repeat the same fact independently, and give extra weight to official pages or named organizations. If the topic affects money, tickets, health, legal risk, travel, public reputation, product decisions, or sports results, wait for stronger confirmation before acting.`,
    `What to watch: The next useful update will be a clearer source with direct evidence, a correction, an official statement, a schedule or price page, a box score, a filing, a status page, or a new report that confirms the key detail independently. If later sources add concrete facts, this page should be updated rather than padded with speculation.`,
    `Bottom line: ${cleanTitle} is worth reading about because the topic is visible and readers are looking for a clear answer. The safest takeaway is to use the source links, focus on confirmed details, and avoid treating repeated headlines as stronger evidence than they really are.`
  ];
}

function normalizeAiContent(aiPost, trend, sources) {
  if (Array.isArray(aiPost.content)) return aiPost.content;
  const paragraphs = [];
  if (aiPost.intro) paragraphs.push(aiPost.intro);
  if (aiPost.body) paragraphs.push(...htmlToParagraphs(aiPost.body));
  return paragraphs.length ? paragraphs : fallbackContent(trend, sources);
}

function htmlToParagraphs(html) {
  return String(html || "")
    .replace(/<\/h2>\s*<p>/gi, ": ")
    .replace(/<h2[^>]*>/gi, "")
    .replace(/<\/li>\s*<li[^>]*>/gi, ". ")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<\/p>|<\/ul>|<\/ol>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(stripHtml)
    .filter(Boolean);
}

function finalizePost(post, trend, sources = []) {
  const title = trimTitle(cleanGeneratedText(post.title || headlineFor(trend.title)), 78);
  const category = post.category || trend.category || classifyTopic(trend.title || title);
  const normalized = {
    ...post,
    title,
    category,
    excerpt: normalizeExcerpt(post.excerpt || professionalExcerpt(trend), trend),
    image: normalizeImage(post.image, trend),
    content: normalizeContent(post.content, trend, sources),
    author: normalizeAuthor(post.author),
    updatedAt: post.updatedAt || post.publishedAt || new Date().toISOString(),
    keyFacts: normalizeKeyFacts(post.keyFacts, trend, sources),
    tags: tagsForPost({ ...post, title, category, trend: trend.title }),
    ogImage: `assets/og/${post.slug}.svg`
  };

  normalized.quality = qualityForPost(normalized);
  return normalized;
}

function preparePostCollection(posts) {
  const titleSeen = new Map();
  const slugSeen = new Map();

  return posts.map((post) => {
    const normalized = { ...post };
    const titleKey = slugify(normalized.title || normalized.trend || "trend");
    const titleCount = titleSeen.get(titleKey) || 0;
    titleSeen.set(titleKey, titleCount + 1);

    if (titleCount > 0) {
      normalized.title = trimTitle(`${normalized.title} (${titleCount + 1})`, 78);
    }

    const baseSlug = normalized.slug || slugify(normalized.title || normalized.trend || "trend");
    const slugCount = slugSeen.get(baseSlug) || 0;
    slugSeen.set(baseSlug, slugCount + 1);
    normalized.slug = slugCount > 0 ? `${baseSlug}-${normalized.id?.slice(0, 6) || slugCount + 1}` : baseSlug;
    normalized.ogImage = `assets/og/${normalized.slug}.svg`;

    const warnings = new Set(normalized.quality?.warnings || []);
    if (titleCount > 0) warnings.add("duplicate-title-adjusted");
    if (slugCount > 0) warnings.add("duplicate-slug-adjusted");

    normalized.quality = qualityForPost(normalized);
    normalized.quality.warnings = [...new Set([...normalized.quality.warnings, ...warnings])];
    return normalized;
  });
}

function normalizeContent(content, trend, sources) {
  const base = Array.isArray(content) && content.length ? content : fallbackContent(trend, sources);
  const cleaned = base
    .map((paragraph) => cleanGeneratedText(paragraph))
    .filter(Boolean);
  const sectionText = cleaned.join("\n");
  const missing = requiredSections.filter((section) => !sectionText.includes(section));
  const count = wordCount(cleaned);
  const hasRightLength = count >= 500 && count <= 900;

  if (missing.length === 0 && hasRightLength) return cleaned;

  const fallback = fallbackContent(trend, sources).map((paragraph) => cleanGeneratedText(paragraph));
  return fallback;
}

function normalizeExcerpt(excerpt, trend) {
  const clean = titleCase(trend.title);
  const traffic = trend.traffic ? ` Search interest is around ${formatTraffic(trend.traffic)}.` : "";
  const text = cleanGeneratedText(excerpt || "");
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 20 && words.length <= 35) return text;
  return cleanGeneratedText(`${clean} is gaining attention in current trend data.${traffic} This briefing summarizes what happened, key source details, and what readers should watch next.`);
}

function cleanGeneratedText(value) {
  let text = repairMojibake(String(value || "")).replace(/\s+/g, " ").trim();
  for (const phrase of bannedPhrases) text = text.replace(phrase, "");
  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function trimTitle(title, maxLength) {
  const clean = cleanGeneratedText(title);
  if (clean.length <= maxLength) return clean;
  const trimmed = clean.slice(0, maxLength - 1).replace(/\s+\S*$/, "").trim();
  return trimmed || clean.slice(0, maxLength);
}

function tagsForPost(post) {
  const parts = [
    post.category,
    ...(String(post.trend || post.title || "").split(/\s+/).filter((word) => word.length > 3).slice(0, 5))
  ];
  return [...new Set(parts.map((part) => titleCase(part)).filter(Boolean))].slice(0, 8);
}

function qualityForPost(post) {
  const sections = requiredSections.filter((section) => (post.content || []).join("\n").includes(section));
  const warnings = [];
  const count = wordCount(post.content || []);

  if (count < 500) warnings.push("below-500-words");
  if (count > 900) warnings.push("over-900-words");
  if (sections.length < requiredSections.length) warnings.push("missing-required-sections");
  if ((post.sources || []).length < 3) warnings.push("thin-source-set");
  if (!Array.isArray(post.keyFacts) || post.keyFacts.length < 3) warnings.push("missing-key-facts");
  if (!post.author?.name) warnings.push("missing-author");
  if (!post.title || post.title.length > 78) warnings.push("title-quality");
  if (!post.excerpt || post.excerpt.split(/\s+/).length < 20) warnings.push("excerpt-too-short");
  if (!post.image?.alt || !post.image?.credit) warnings.push("image-metadata");
  if (containsBannedPhrase([post.title, post.excerpt, ...(post.content || [])].join(" "))) warnings.push("banned-phrase");
  warnings.push(...categoryWarnings(post));

  return {
    wordCount: count,
    sections,
    warnings: [...new Set(warnings)]
  };
}

function containsBannedPhrase(value) {
  return bannedPhrases.some((phrase) => {
    phrase.lastIndex = 0;
    return phrase.test(value);
  });
}

function categoryWarnings(post) {
  const text = [post.title, post.excerpt, ...(post.content || [])].join(" ").toLowerCase();
  const warnings = [];
  if ((post.category === "News" || /politics|court|law|legal|health|medicare|stock|market|finance/.test(text)) && !/verify|official|confirm|caution|trusted/i.test(text)) {
    warnings.push("needs-verification-language");
  }
  if (post.category === "Sports" && /score|wins|defeats|beats/.test(text) && !/confirm|official|schedule|result/i.test(text)) {
    warnings.push("sports-result-caution");
  }
  return warnings;
}

function categoryCaution(category, title) {
  if (category === "Business") return "For market or company topics, verify figures through current filings, exchange data, or trusted financial reporting.";
  if (category === "Sports") return "For sports topics, verify scores, schedules, injuries, and standings through official league or team channels.";
  if (category === "News") return "For civic, legal, health, or political topics, check official statements and primary records before relying on any claim.";
  if (category === "Technology") return "For technology topics, check official product pages, status pages, documentation, or release notes before acting.";
  if (category === "Culture") return "For entertainment and celebrity topics, separate confirmed reporting from speculation, fan discussion, and promotional material.";
  return `For ${title}, prioritize recent updates and named public records over repeated summaries.`;
}

function formatTraffic(value) {
  return String(value || "").replace(/,+/g, ",").replace(/,$/, "").trim() || "elevated";
}

async function backfillExistingPosts() {
  const posts = await readJson(paths.posts, []);
  const force = globalThis.process?.argv?.includes("--force");
  const upgraded = preparePostCollection(await Promise.all(posts.map(async (post) => {
    const trend = {
      title: post.trend || post.title,
      category: classifyTopic(post.trend || post.title),
      traffic: extractTraffic(post.content || [])
    };
    const existingSources = post.sources || [];
    const needsSourceRefresh = existingSources.length < 3 || existingSources.some((source) => !source.source || /news\.google\.com/i.test(source.source || source.url || ""));
    const sources = needsSourceRefresh ? await fetchNewsSources(trend.title) : existingSources;
    const usableSources = sources.length ? sources : post.sources || [];

    return finalizePost({
      ...post,
      title: headlineFor(trend.title),
      category: trend.category,
      excerpt: professionalExcerpt(trend),
      image: imageForPost(trend),
      sources: usableSources,
      content: !force && Array.isArray(post.content) && wordCount(post.content) >= 500 && wordCount(post.content) <= 900 ? post.content : fallbackContent(trend, usableSources),
      productionMethod: post.productionMethod || "editorial-workflow"
    }, trend, usableSources);
  })));

  await writeFile(paths.posts, `${JSON.stringify(upgraded, null, 2)}\n`, "utf8");
  await writeDerivedSiteFiles(upgraded);
  console.log(`Backfilled ${upgraded.length} post(s).`);
}

async function writeDerivedSiteFiles(posts) {
  const sorted = [...posts].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await mkdir(paths.postDataDir, { recursive: true });
  await mkdir(paths.postPagesDir, { recursive: true });
  await mkdir(paths.ogDir, { recursive: true });
  await cleanGeneratedDirectory(paths.postDataDir, ".json");
  await cleanGeneratedDirectory(paths.postPagesDir, ".html");
  await cleanGeneratedDirectory(paths.ogDir, ".svg");

  const metadata = sorted.map(postMetadata);
  await writeFile(paths.index, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  for (const post of sorted) {
    await writeFile(new URL(`${post.slug}.svg`, paths.ogDir), generateOgSvg(post), "utf8");
    await writeFile(new URL(`${post.slug}.json`, paths.postDataDir), `${JSON.stringify(post, null, 2)}\n`, "utf8");
    await writeFile(new URL(`${post.slug}.html`, paths.postPagesDir), buildPostPage(post, sorted), "utf8");
  }

  await writeFile(paths.rss, buildRss(sorted), "utf8");
  await writeFile(paths.sitemap, buildSitemap(sorted), "utf8");
}

async function cleanGeneratedDirectory(directory, extension) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => rm(new URL(entry.name, directory), { force: true })));
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
    url: postUrl(post),
    readingTime: readingTime(post)
  };
}

function professionalExcerpt(trend) {
  const clean = titleCase(trend.title);
  const templates = [
    `${clean} is making headlines. Here is the current picture and what readers should watch for next.`,
    `Why is ${clean} trending? This briefing separates the strongest signals from noise and speculation.`,
    `A focused briefing on ${clean}: what the headlines reveal, where the story stands, and what comes next.`,
    `${clean} is drawing attention across multiple channels. Here is the current picture with useful context.`,
    `The ${clean} conversation is moving quickly. This summary explains the context, signals, and open questions.`,
    `What changed around ${clean}? We review the visible coverage and highlight the details readers should confirm.`
  ];
  return templates[hashIndex(clean, templates.length)];
}

function normalizeImage(image, trend) {
  const fallback = imageForPost(trend);
  if (!image || typeof image !== "object") return fallback;
  return {
    url: typeof image.url === "string" && image.url ? image.url : fallback.url,
    alt: typeof image.alt === "string" && image.alt ? image.alt : fallback.alt,
    credit: typeof image.credit === "string" && image.credit ? image.credit : fallback.credit
  };
}

function imageForPost(trend) {
  const topic = String(trend.title || "").toLowerCase();
  const category = trend.category || classifyTopic(trend.title || "");
  const library = imageLibrary();
  const matched = library.find((item) => item.match.test(topic));
  const categoryPool = library.filter((item) => item.category === category);
  const trendPool = library.filter((item) => item.category === "Trends");
  const pool = categoryPool.length ? categoryPool : trendPool;
  const image = matched || pool[hashIndex(topic || category, pool.length)] || library[0];

  const isRemote = /^https?:\/\//i.test(image.url);

  return {
    url: isRemote ? `${image.url}?auto=format&fit=crop&w=1400&q=82` : image.url,
    alt: `${titleCase(trend.title || "Trending topic")} related editorial image`,
    credit: image.credit || "ContextWire editorial graphic"
  };
}

function imageLibrary() {
  return [
    { category: "Business", match: /(ford|\bstock\b|market|nasdaq|smci|dram|\bmu\b|earnings|shares|trading|finance|bank|crypto|bitcoin|inflation)/, url: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3", credit: "Unsplash" },
    { category: "Sports", match: /(nba|warriors|basketball|playoffs|bracket)/, url: "https://images.unsplash.com/photo-1546519638-68e109498ffc", credit: "Unsplash" },
    { category: "Sports", match: /(tennis|sinner|medvedev|madison|keys|qinwen|zheng)/, url: "https://images.unsplash.com/photo-1622279457486-62dcc4a431d6", credit: "Unsplash" },
    { category: "Sports", match: /(golf|rory|mcilroy)/, url: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b", credit: "Unsplash" },
    { category: "Sports", match: /(baseball|alek|adley|rutschman|thomas|tanner|scott|oregon state)/, url: "https://images.unsplash.com/photo-1508344928928-7165b67de128", credit: "Unsplash" },
    { category: "Sports", match: /(ufc|fight|floyd|mayweather|boxing|makhachev|volkov|press conference)/, url: "https://images.unsplash.com/photo-1549719386-74dfcbf7dbed", credit: "Unsplash" },
    { category: "Sports", match: /(soccer|chelsea|forest|nottm|bayern|munich|psg|lorient|wsl|league|match|cup)/, url: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55", credit: "Unsplash" },
    { category: "Sports", match: /(cricket|ipl|csk|standings)/, url: "https://images.unsplash.com/photo-1531415074968-036ba1b575da", credit: "Unsplash" },
    { category: "Sports", match: /(nfl|football|ameer|abdullah)/, url: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390", credit: "Unsplash" },
    { category: "Culture", match: /(bruno|mars|music|album|concert|singer)/, url: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4", credit: "Unsplash" },
    { category: "Culture", match: /(movie|tv|series|episode|trailer|netflix|nbc|actor|actress|ben affleck|rachel|zegler|gandolfini|panettiere|seacrest|rapaport|jaafar|jackson|boys)/, url: "https://images.unsplash.com/photo-1485846234645-a62644f84728", credit: "Unsplash" },
    { category: "Culture", match: /(met gala|celebrity|red carpet|appearance|jewelry|meyer)/, url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30", credit: "Unsplash" },
    { category: "Culture", match: /(book|novel|detective|sheep|quintel|animation|cartoon)/, url: "assets/generated/contextwire-culture-books.png", credit: "ContextWire editorial graphic" },
    { category: "News", match: /(white house|ballroom|election|president|minister|senate|policy|politics|government|medicare|health|adhikari|pollard|socialism)/, url: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620", credit: "Unsplash" },
    { category: "News", match: /(murrow|journalism|news|media|press)/, url: "https://images.unsplash.com/photo-1504711434969-e33886168f5c", credit: "Unsplash" },
    { category: "Technology", match: /(\bai\b|tech|iphone|google|microsoft|software|cyber|\bapp\b|images|caro|claire|burke)/, url: "https://images.unsplash.com/photo-1518770660439-4636190af475", credit: "Unsplash" },
    { category: "Business", match: /(apac|global|business|economy|company)/, url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f", credit: "Unsplash" },
    { category: "Culture", match: /(firehouse|subs|food|restaurant)/, url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5", credit: "Unsplash" },
    { category: "Sports", match: /(sports|athlete|game|tournament)/, url: "assets/generated/contextwire-sports-arena.png", credit: "ContextWire editorial graphic" },
    { category: "Technology", match: /(technology|digital|internet)/, url: "assets/generated/contextwire-trending-editorial.png", credit: "ContextWire editorial graphic" },
    { category: "Trends", match: /(slack|platform|online|web|social|search)/, url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72", credit: "Unsplash" },
    { category: "Trends", match: /(daily|update|briefing|public|conversation)/, url: "https://images.unsplash.com/photo-1495020689067-958852a7765e", credit: "Unsplash" },
    { category: "Trends", match: /(trend|viral|attention|topic)/, url: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173", credit: "Unsplash" },
    { category: "Business", match: /(business|finance)/, url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f", credit: "Unsplash" },
    { category: "Culture", match: /(culture|entertainment|review)/, url: "https://images.unsplash.com/photo-1485846234645-a62644f84728", credit: "Unsplash" },
    { category: "News", match: /(court|law|public|civic)/, url: "assets/generated/contextwire-civic-analysis.png", credit: "ContextWire editorial graphic" },
    { category: "Trends", match: /(trend|search|viral|internet|topic)/, url: "assets/generated/contextwire-trending-editorial.png", credit: "ContextWire editorial graphic" }
  ];
}

function extractTraffic(content) {
  const joined = Array.isArray(content) ? content.join(" ") : "";
  return joined.match(/around\s+([0-9,+]+)/i)?.[1] || "";
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
      if (["csk", "mi", "ufc", "ipl", "nba", "nfl", "mlb", "psg", "nbc", "wsl", "apac", "smci", "dram", "jg", "ai"].includes(word.toLowerCase())) return word.toUpperCase();
      if (index > 0 && smallWords.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ContextWire/1.0" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseRss(xml) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => ({
    title: decodeXml(readTag(item, "title")),
    link: decodeXml(readTag(item, "link")),
    pubDate: decodeXml(readTag(item, "pubDate")),
    approxTraffic: decodeXml(readTag(item, "ht:approx_traffic") || readTag(item, "approx_traffic")),
    description: stripHtml(decodeXml(readTag(item, "description")))
  }));
}

function readTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return "";
  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeXml(value) {
  return repairMojibake(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))));
}

function repairMojibake(value) {
  let text = value;
  if (/[\u00c2\u00c3\u00e2]/.test(text)) {
    text = Buffer.from(text, "latin1").toString("utf8");
  }

  return text
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2026/g, "...");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function stripPublisher(title) {
  return String(title || "").replace(/\s+-\s+[^-]+$/, "").trim();
}

function publisherFromTitle(title) {
  const match = String(title || "").match(/\s+-\s+([^-]+)$/);
  return match ? cleanGeneratedText(match[1]) : "";
}

function normalizeSourcesForPost(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      title: cleanGeneratedText(source.title || "Source used for this briefing"),
      url: String(source.url || "").trim(),
      publishedAt: source.publishedAt || null,
      source: cleanGeneratedText(source.source || publisherFromTitle(source.title) || hostName(source.url))
    }))
    .filter((source) => source.title && /^https?:\/\//i.test(source.url));
}

function sourceLabel(source) {
  const publisherName = !source.source || /news\.google\.com/i.test(source.source) ? "Linked source" : source.source;
  const publisher = publisherName ? `${publisherName}: ` : "";
  return `${publisher}${source.title}`;
}

function keyFactsFor(trend, sources) {
  const cleanTitle = titleCase(trend.title || "this topic");
  const facts = [];
  if (trend.traffic) facts.push(`Search interest was reported around ${formatTraffic(trend.traffic)}.`);
  for (const source of normalizeSourcesForPost(sources).slice(0, 5)) {
    const publisherName = !source.source || /news\.google\.com/i.test(source.source) ? "A linked source" : source.source;
    facts.push(`${publisherName} reported: ${source.title}.`);
  }
  if (!facts.length) facts.push(`${cleanTitle} appeared in public trend data and needs stronger source confirmation.`);
  while (facts.length < 3) facts.push(`${cleanTitle} should be checked against newer reporting before readers rely on time-sensitive details.`);
  return [...new Set(facts.map(cleanGeneratedText))].slice(0, 6);
}

function normalizeKeyFacts(keyFacts, trend, sources) {
  const facts = (Array.isArray(keyFacts) ? keyFacts : [])
    .map(cleanGeneratedText)
    .filter(Boolean)
    .filter((fact) => !/Readers should compare newer reporting/i.test(fact))
    .slice(0, 6);
  const unique = [...new Set(facts)];
  return unique.length >= 3 ? unique : keyFactsFor(trend, sources);
}

function normalizeAuthor(author) {
  if (!author || typeof author !== "object") return defaultAuthor;
  return {
    ...defaultAuthor,
    ...author,
    name: cleanGeneratedText(author.name || defaultAuthor.name),
    bio: cleanGeneratedText(author.bio || defaultAuthor.bio),
    title: cleanGeneratedText(author.title || defaultAuthor.title),
    url: author.url || defaultAuthor.url
  };
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function headlineFor(topic) {
  const clean = titleCase(topic);
  const patterns = [
    `${clean}: What Happened and Key Details`,
    `${clean}: Confirmed Details and What Comes Next`,
    `${clean}: Source-Checked Reader Guide`,
    `${clean}: Latest Public Details Explained`,
    `${clean}: Key Facts and Background`,
    `${clean}: What Readers Should Know Now`
  ];
  return patterns[hashIndex(clean, patterns.length)];
}

function shouldRefreshTitle(post, trend) {
  if (!post.title) return true;
  const stale = String(post.title).toLowerCase() === `${String(trend.title).toLowerCase()}: what to watch today`;
  return stale || post.title === post.title.toLowerCase();
}

function hashIndex(value, length) {
  return createHash("sha256").update(slugify(value)).digest()[0] % length;
}

function classifyTopic(topic) {
  const text = topic.toLowerCase();
  if (/(\bai\b|tech|iphone|google|microsoft|tesla|nvidia|\bapp\b|software|cyber|images|caro|claire|burke)/.test(text)) return "Technology";
  if (/(\bstock\b|market|nasdaq|fed|inflation|crypto|bitcoin|earnings|bank|finance|dram|smci|ford|\bmu\b|apac)/.test(text)) return "Business";
  if (/(nba|nfl|mlb|soccer|cricket|ufc|game|cup|league|ipl|csk|makhachev|bayern|munich|psg|lorient|warriors|playoffs|tennis|sinner|medvedev|keys|zheng|golf|mcilroy|baseball|mayweather|volkov|wsl|chelsea|forest|abdullah|scott|thomas|rutschman|adley)/.test(text)) return "Sports";
  if (/(movie|music|album|tv|netflix|celebrity|trailer|festival|book|novel|detective|sheep|bruno|mars|affleck|zegler|gandolfini|panettiere|seacrest|rapaport|met gala|jackson|nbc|boys|quintel|meyer|firehouse|subs)/.test(text)) return "Culture";
  if (/(election|court|president|minister|law|policy|senate|socialism|politics|white house|ballroom|murrow|pollard|adhikari|medicare|health)/.test(text)) return "News";
  return "Trends";
}

function slugify(value) {
  return String(value || "post")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";
}

function topicKey(value) {
  return slugify(value).replace(/-\d+$/, "");
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

function buildRss(posts) {
  const items = posts.slice(0, 40).map((post) => `
    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${xmlEscape(postUrl(post))}</link>
      <guid>${xmlEscape(postUrl(post))}</guid>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <description>${xmlEscape(post.excerpt)}</description>
    </item>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(config.blogName)}</title>
    <link>${xmlEscape(config.siteUrl)}</link>
    <description>Trend briefings with concise context and daily updates.</description>${items}
  </channel>
</rss>
`;
}

function buildSitemap(posts) {
  const urls = [
    { loc: `${config.siteUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/archive.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/about.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/contact.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/author/contextwire-editorial-desk.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/corrections.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/privacy.html`, lastmod: new Date().toISOString() },
    { loc: `${config.siteUrl}/terms.html`, lastmod: new Date().toISOString() },
    ...posts.slice(0, 80).map((post) => ({ loc: postUrl(post), lastmod: post.publishedAt }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url><loc>${xmlEscape(item.loc)}</loc><lastmod>${xmlEscape(new Date(item.lastmod).toISOString().slice(0, 10))}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}
</urlset>
`;
}

function postUrl(post) {
  return `${config.siteUrl}/posts/${post.slug}.html`;
}

function buildPostPage(post, posts) {
  const related = posts
    .filter((item) => item.slug !== post.slug && item.category === post.category)
    .slice(0, 3);
  const description = post.excerpt || `${post.title} from ${config.blogName}.`;
  const canonical = postUrl(post);
  const imageUrl = absoluteAssetUrl(post.ogImage || post.image?.url);
  const published = new Date(post.publishedAt).toISOString();
  const updated = new Date(post.updatedAt || post.publishedAt).toISOString();
  const category = post.category || "Trend";
  const author = normalizeAuthor(post.author);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeAttribute(description)}">
  <meta name="theme-color" content="#0f766e">
  <link rel="canonical" href="${escapeAttribute(canonical)}">
  <meta property="og:title" content="${escapeAttribute(post.title)}">
  <meta property="og:description" content="${escapeAttribute(description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeAttribute(canonical)}">
  <meta property="og:image" content="${escapeAttribute(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttribute(post.title)}">
  <meta name="twitter:description" content="${escapeAttribute(description)}">
  <meta name="twitter:image" content="${escapeAttribute(imageUrl)}">
  <title>${escapeHtml(post.title)} | ${escapeHtml(config.blogName)}</title>
  <link rel="icon" href="../assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../assets/icons/icon-192.svg">
  <link rel="manifest" href="../site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Newsreader:opsz,wght@6..72,500;6..72,650;6..72,750&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/styles.css">
  <script type="application/ld+json">${JSON.stringify(articleSchema(post, canonical, imageUrl))}</script>
</head>
<body class="post-page">
  <div class="reading-progress" aria-hidden="true"></div>
  <header class="post-header">
    <nav class="topbar" aria-label="Primary">
      <a class="brand" href="../">
        <img class="brand-logo" src="../assets/icons/site-logo.svg" alt="" width="48" height="48" aria-hidden="true">
        <span><strong>ContextWire</strong><small>Source-checked context</small></span>
      </a>
      <div class="nav-actions">
        <a href="../archive.html">Archive</a>
        <a href="../about.html">About</a>
        <a href="../contact.html">Contact</a>
        <a href="../privacy.html">Privacy</a>
        <a href="../terms.html">Terms</a>
      </div>
    </nav>
    <div class="breadcrumb">
      <a href="../">Home</a>
      <span>/</span>
      <a href="../archive.html">Archive</a>
      <span>/</span>
      <strong>${escapeHtml(category)}</strong>
    </div>
    <section class="post-hero">
      <p class="eyebrow category" data-cat="${escapeAttribute(category)}">${escapeHtml(category)}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="lede">${escapeHtml(description)}</p>
      <div class="feature-meta">
        <time datetime="${escapeAttribute(published)}">${escapeHtml(new Date(post.publishedAt).toUTCString())}</time>
        <span>Updated ${escapeHtml(new Date(updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</span>
        <span>By <a href="../author/contextwire-editorial-desk.html">${escapeHtml(author.name)}</a></span>
        <span>${escapeHtml(readingTime(post))} read</span>
        <span>${escapeHtml(category)}</span>
      </div>
    </section>
  </header>
  <main class="post-main article-main">
    <div class="article-wrap">
    <article class="feature-article post-detail reading-layout">
      <div class="post-body">
        ${post.image?.url ? `<figure class="feature-image"><img src="${escapeAttribute(pageAssetUrl(post.image.url))}" alt="${escapeAttribute(post.image.alt || `${post.title} image`)}" width="1400" height="788" loading="eager" decoding="async" fetchpriority="high"><figcaption>${escapeHtml(post.image.credit || "Editorial image")}</figcaption></figure>` : ""}
        ${articleContentHtml(post)}
        ${sourceBoxHtml(post)}
        ${authorBoxHtml(author)}
        <div class="share-buttons" aria-label="Share this article">
          <a class="read-more-link" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(canonical)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener">Share on X</a>
          <button class="read-more-link copy-link" type="button">Copy link</button>
        </div>
      </div>
    </article>
    <aside class="article-sidebar" aria-label="Briefing details">
      <div class="sidebar-block">
        <p class="card-label">Briefing details</p>
        <dl>
          <div><dt>Topic</dt><dd>${escapeHtml(category)}</dd></div>
          <div><dt>Published</dt><dd>${escapeHtml(new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</dd></div>
          <div><dt>Updated</dt><dd>${escapeHtml(new Date(updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</dd></div>
          <div><dt>Author</dt><dd><a href="../author/contextwire-editorial-desk.html">${escapeHtml(author.name)}</a></dd></div>
          <div><dt>Read time</dt><dd>${escapeHtml(readingTime(post))}</dd></div>
        </dl>
      </div>
      ${related.length ? `<div class="sidebar-block"><p class="card-label">Related reads</p><ol class="sidebar-related">${related.map((item) => `<li><a href="${escapeAttribute(`${item.slug}.html`)}">${escapeHtml(item.title)}</a></li>`).join("")}</ol></div>` : ""}
    </aside>
    </div>
    ${related.length ? `<section class="related-posts" aria-labelledby="relatedTitle"><div class="section-head"><div><p class="eyebrow">Next reads</p><h2 id="relatedTitle">Related briefings</h2></div></div><div class="post-grid">${related.map(relatedCard).join("")}</div></section>` : ""}
  </main>
  <footer class="footer">
    <div>
      ${footerMarkup("../")}
    </div>
  </footer>
  <button class="back-to-top" type="button" aria-label="Back to top">&uarr;</button>
  <script src="../assets/post.js" defer></script>
</body>
</html>
`;
}

function relatedCard(post) {
  const category = post.category || "Trend";
  return `<article class="post-card"><a class="card-link" href="${escapeAttribute(`${post.slug}.html`)}">${post.image?.url ? `<img class="card-image" src="${escapeAttribute(pageAssetUrl(post.image.url))}" alt="${escapeAttribute(post.image.alt || `${post.title} image`)}" loading="lazy" decoding="async" width="640" height="400">` : ""}<span class="category" data-cat="${escapeAttribute(category)}">${escapeHtml(category)}</span><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt || "")}</p><div class="card-meta"><time datetime="${escapeAttribute(post.publishedAt)}">${escapeHtml(new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</time><span>${escapeHtml(readingTime(post))}</span></div></a></article>`;
}

function articleContentHtml(post) {
  const blocks = [];
  const keyFacts = normalizeKeyFacts(post.keyFacts, post, post.sources || []);
  for (const paragraph of post.content || []) {
    const parsed = sectionParagraph(paragraph);
    if (!parsed) {
      blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
      continue;
    }
    blocks.push(`<h2>${escapeHtml(parsed.heading)}</h2>`);
    if (parsed.key === "Key details" && keyFacts.length) {
      blocks.push(`<ul class="key-facts">${keyFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`);
    }
    if (parsed.body) blocks.push(`<p>${escapeHtml(parsed.body)}</p>`);
  }
  return blocks.join("\n        ");
}

function sectionParagraph(paragraph) {
  const text = cleanGeneratedText(paragraph);
  const match = text.match(/^(What happened|Key details|Background|Why it matters|What's confirmed|What to watch|Bottom line):\s*(.*)$/i);
  if (!match) return null;
  const heading = match[1].replace(/\b\w/g, (char) => char.toUpperCase()).replace("What'S", "What's");
  return { key: heading, heading, body: match[2] || "" };
}

function sourceBoxHtml(post) {
  const sources = normalizeSourcesForPost(post.sources || []).slice(0, 8);
  if (!sources.length) return "";
  return `<section class="source-box" aria-labelledby="sources-${escapeAttribute(post.slug)}">
          <p class="card-label" id="sources-${escapeAttribute(post.slug)}">Sources checked</p>
          <p>These links are provided so readers can inspect the public source trail behind this article.</p>
          <ol>${sources.map((source) => `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="nofollow noopener">${escapeHtml(source.title)}</a>${source.source ? ` <span>${escapeHtml(source.source)}</span>` : ""}</li>`).join("")}</ol>
        </section>`;
}

function authorBoxHtml(author) {
  return `<aside class="author-box" aria-label="Article author">
          <a href="../author/contextwire-editorial-desk.html" class="author-avatar" aria-hidden="true">CW</a>
          <div>
            <p class="card-label">Written by</p>
            <h2><a href="../author/contextwire-editorial-desk.html">${escapeHtml(author.name)}</a></h2>
            <p>${escapeHtml(author.bio)}</p>
          </div>
        </aside>`;
}

function footerMarkup(prefix = "") {
  return `
      <div class="footer-grid">
        <div>
          <p class="footer-brand"><img src="${prefix}assets/icons/site-logo.svg" alt="" width="40" height="40" aria-hidden="true"><strong>ContextWire</strong></p>
          <p>Clear source-checked briefings for readers who want context quickly, without the noise.</p>
        </div>
        <nav aria-label="Footer quick links">
          <strong>Quick Links</strong>
          <ul>
            <li><a href="${prefix}archive.html">Archive</a></li>
            <li><a href="${prefix}about.html">About</a></li>
            <li><a href="${prefix}contact.html">Contact</a></li>
            <li><a href="${prefix}privacy.html">Privacy</a></li>
            <li><a href="${prefix}terms.html">Terms & Credits</a></li>
          </ul>
        </nav>
        <nav aria-label="Footer categories">
          <strong>Categories</strong>
          <ul>
            <li><a href="${prefix}archive.html?category=Sports">Sports</a></li>
            <li><a href="${prefix}archive.html?category=Business">Business</a></li>
            <li><a href="${prefix}archive.html?category=Technology">Technology</a></li>
          </ul>
        </nav>
      </div>
      <div class="footer-cta">
        <strong>Read the Latest Briefings</strong>
        <p>Browse fresh context across sports, business, technology, culture, and public affairs.</p>
        <a class="read-more-link" href="${prefix}archive.html">Open Archive</a>
      </div>
      <p class="footer-note">&copy; ${new Date().getFullYear()} ContextWire. Built for clear context, source checks, and practical topic discovery.</p>`;
}

function articleSchema(post, canonical, imageUrl) {
  const author = normalizeAuthor(post.author);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.title,
    description: post.excerpt,
    datePublished: new Date(post.publishedAt).toISOString(),
    dateModified: new Date(post.updatedAt || post.publishedAt).toISOString(),
    mainEntityOfPage: canonical,
    image: imageUrl,
    articleSection: post.category || "Trends",
    wordCount: wordCount(post.content || []),
    author: { "@type": "Organization", name: author.name, url: author.url },
    publisher: {
      "@type": "Organization",
      name: config.blogName,
      logo: { "@type": "ImageObject", url: `${config.siteUrl}/assets/icons/icon-512.svg` }
    }
  };
}

function generateOgSvg(post) {
  const category = post.category || "Trend";
  const palette = categoryPalette(category);
  const titleLines = wrapSvgLines(post.title || "Trend briefing", 32, 4);
  const date = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Latest briefing";
  const yStart = titleLines.length === 1 ? 310 : titleLines.length === 2 ? 276 : titleLines.length === 3 ? 242 : 214;
  const titleMarkup = titleLines
    .map((line, index) => `<text x="72" y="${yStart + index * 66}" font-family="Georgia, 'Times New Roman', serif" font-size="60" font-weight="700" fill="#ffffff">${escapeSvg(line)}</text>`)
    .join("\n  ");
  const number = String(hashIndex(post.slug || post.title || category, 90) + 1).padStart(2, "0");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeSvg(post.title || "ContextWire briefing")}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.start}"/>
      <stop offset="1" stop-color="${palette.end}"/>
    </linearGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0v56" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)" opacity=".65"/>
  <rect x="44" y="44" width="1112" height="542" rx="22" fill="#07111f" fill-opacity=".42" stroke="#ffffff" stroke-opacity=".2"/>
  <text x="72" y="96" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="800" fill="${palette.accent}" letter-spacing="2">${escapeSvg(category.toUpperCase())}</text>
  <text x="72" y="136" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#cbd5e1">TREND BRIEFING</text>
  ${titleMarkup}
  <text x="72" y="552" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" fill="#ffffff">CONTEXTWIRE</text>
  <text x="1128" y="552" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#dbeafe">${escapeSvg(date)}</text>
  <text x="1010" y="292" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="176" font-weight="700" fill="#ffffff" opacity=".08">${number}</text>
</svg>
`;
}

function categoryPalette(category) {
  const palettes = {
    Business: { start: "#10233f", end: "#075985", accent: "#facc15" },
    Sports: { start: "#052e16", end: "#0f766e", accent: "#22c55e" },
    Technology: { start: "#111827", end: "#155e75", accent: "#38bdf8" },
    Culture: { start: "#3b1238", end: "#be185d", accent: "#fb7185" },
    News: { start: "#1e293b", end: "#7f1d1d", accent: "#f97316" },
    Trends: { start: "#101827", end: "#3730a3", accent: "#2dd4bf" }
  };
  return palettes[category] || palettes.Trends;
}

function wrapSvgLines(value, maxChars, maxLines) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,:;!?]$/, "")}...`;
  }
  return lines.length ? lines : ["Trend briefing"];
}

function escapeSvg(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function pageAssetUrl(url) {
  if (/^https?:\/\//i.test(url || "")) return url;
  return `../${String(url || "").replace(/^\.?\//, "")}`;
}

function absoluteAssetUrl(url) {
  if (/^https?:\/\//i.test(url || "")) return url;
  return `${config.siteUrl}/${String(url || "").replace(/^\.?\//, "")}`;
}

function readingTime(post) {
  const words = [post.title, post.excerpt, ...(post.content || [])].join(" ").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 190))} min`;
}

function xmlEscape(value) {
  return String(value || "").replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  }[char]));
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}
