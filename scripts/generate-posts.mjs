import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "TrendPulse Daily",
  region: process.env.BLOG_REGION || "US",
  language: process.env.BLOG_LANGUAGE || "en-US",
  postsPerRun: clampNumber(process.env.POSTS_PER_RUN, 1, 10, 2),
  maxPosts: clampNumber(process.env.MAX_POSTS, 20, 500, 160),
  siteUrl: trimSlash(process.env.SITE_URL || "https://sattarwajith-boop.github.io/Blog-Website"),
  openAiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
};

const paths = {
  posts: new URL("data/posts.json", root),
  index: new URL("data/index.json", root),
  postDataDir: new URL("data/posts/", root),
  postPagesDir: new URL("posts/", root),
  topics: new URL("data/topics.json", root),
  rss: new URL("rss.xml", root),
  sitemap: new URL("sitemap.xml", root)
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

  const nextPosts = [...generated, ...posts].slice(0, config.maxPosts);
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
  const query = encodeURIComponent(`"${topic}" when:1d`);
  const newsUrl = `https://news.google.com/rss/search?q=${query}&hl=${config.language}&gl=${config.region}&ceid=${config.region}:${config.language.split("-")[0]}`;

  try {
    const xml = await fetchText(newsUrl);
    return parseRss(xml).slice(0, 6).map((item) => ({
      title: stripPublisher(item.title),
      url: item.link,
      publishedAt: item.pubDate || null
    }));
  } catch (error) {
    console.warn(`News lookup failed for ${topic}: ${error.message}`);
    return [];
  }
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
    publishedAt: now,
    generatedBy: config.openAiKey ? "openai-assisted" : "template"
  };

  if (!config.openAiKey) return base;

  try {
    const aiPost = await generateWithOpenAI(trend, sources);
    return {
      ...base,
      title: aiPost.title || base.title,
      excerpt: aiPost.excerpt || base.excerpt,
      image: normalizeImage(aiPost.image, trend),
      content: Array.isArray(aiPost.content) && aiPost.content.length ? aiPost.content.slice(0, 18) : base.content
    };
  } catch (error) {
    console.warn(`OpenAI generation failed for ${trend.title}: ${error.message}`);
    return base;
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
          content: "Write professional long-form trend analysis from only the provided trend data and source headlines. Do not invent events, quotes, scores, dates, statistics, or claims beyond the provided inputs. If evidence is limited, say what readers should verify. Return strict JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            trend: trend.title,
            category: trend.category,
            approxTraffic: trend.traffic || null,
            sourceItems: providedSources,
            image: imageForPost(trend),
            requiredShape: {
              title: "string under 78 chars",
              excerpt: "specific summary under 220 chars",
              image: {
                url: "use the supplied image.url exactly",
                alt: "descriptive alt text using the trend title",
                credit: "use the supplied image.credit exactly"
              },
              content: [
                "10 to 14 paragraphs totaling 900 to 1200 words",
                "Start with a direct context paragraph",
                "Explain why the topic is trending based on source headlines and search interest",
                "Summarize key developments cautiously",
                "Include a section-like paragraph starting with 'Why it matters:'",
                "Include a section-like paragraph starting with 'What to watch next:'",
                "Close by reminding readers to verify fast-moving details from the linked sources"
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
  const sourceNames = sources.slice(0, 6).map((source) => source.title);
  const topSources = sourceNames.length ? sourceNames.join("; ") : "related source coverage was limited at generation time";
  const trafficLine = trend.traffic ? `Google Trends reported search interest around ${trend.traffic}, which suggests the topic is attracting enough attention to deserve a fuller briefing.` : "The topic appeared in public trend data, which suggests a measurable spike in attention even when exact search volume is not available.";

  return [
    `${cleanTitle} is moving through today's trend cycle, and the signal is strong enough to merit more than a quick headline scan. ${trafficLine} This briefing is written as a source-aware overview: it uses the visible trend title, related headlines, and timing clues as the evidence base, while avoiding claims that are not supported by the linked material.`,
    `The first thing to understand is that trending attention rarely comes from one simple cause. A spike can be driven by breaking news, fan conversation, schedule timing, public disagreement, market reaction, or a wave of social sharing. For ${cleanTitle}, the available source headlines point to a developing conversation in the ${category.toLowerCase()} lane rather than a settled story. That means readers should treat this as a live briefing and use the source links for confirmation before repeating any precise details.`,
    `Recent source headlines include: ${topSources}. These headlines are useful because they show what publishers and search users are currently connecting to the topic. They do not, by themselves, prove every claim in the broader conversation. The safest reading is that the topic has enough momentum to pull together several strands of coverage, and those strands are what make the subject worth watching today.`,
    `Context: ${cleanTitle} is best understood as a snapshot of attention at a specific moment. Search interest often rises when people want a quick answer: what happened, why it matters, where to watch, who is involved, what changed, or whether a rumor is true. A professional reader should separate the existence of interest from the accuracy of every surrounding claim. The trend tells us people are asking; the source links help answer which parts of the story are grounded.`,
    `Why it is trending: The topic appears to be gaining traction because multiple headlines are clustering around it within a short window. That clustering is important. When several outlets or feeds mention the same subject, search demand often follows as readers try to compare versions, check timing, or understand the practical impact. In an automated briefing, this is the difference between a random phrase and a topic with enough evidence to deserve editorial treatment.`,
    `Key developments: The most useful details are the ones that appear consistently across the available source titles. If a source headline mentions an announcement, matchup, review, warning, market signal, or public reaction, that should be read as a clue for further verification. The article intentionally does not add unsupported specifics, because fast-moving trend posts can become misleading when they fill gaps with assumptions. Instead, it identifies the reliable shape of the conversation and points readers to the linked coverage.`,
    `Audience impact: For casual readers, the immediate value is orientation. They can quickly see why the term is appearing, what kind of sources are discussing it, and whether the story belongs to sport, culture, business, politics, technology, or general news. For creators, analysts, and site owners, the value is different: this topic may represent a short-lived opportunity for timely commentary, comparison pieces, explainer posts, or social updates that answer the questions people are already searching.`,
    `Reader takeaway: The practical way to use this briefing is to move from awareness to verification. Start with the headline cluster, note which details appear more than once, and then open the strongest source links before forming a conclusion. That workflow keeps the article useful without pretending that an automated trend scan can replace fresh reporting, official records, or expert analysis.`,
    `Why it matters: A trend like ${cleanTitle} matters because attention is a limited resource. When search demand gathers around a subject, it often reveals a public information gap. People are not only looking for the headline; they are looking for context, reliability, and next steps. A well-built automated blog should therefore do more than repeat the trend name. It should slow the topic down, show the evidence, and make clear where uncertainty remains.`,
    `Source confidence: This post uses the related source list as its guardrail. When the source list is broad and recent, the article can speak more confidently about the shape of the discussion. When the list is thin, mixed, or oddly matched, the article should be more cautious. That is why this briefing uses careful language such as "appears," "suggests," and "worth watching." Those words are not weakness; they are part of responsible automated publishing.`,
    `What to watch next: Look for primary-source updates, official statements, schedule changes, score or market movement, published reviews, direct quotes, or follow-up reporting that confirms the early signal. If the topic continues to appear across fresh sources, it may deserve a deeper follow-up article. If the spike fades quickly or sources contradict each other, the safest move is to treat this as a short attention wave rather than a durable story.`,
    `Editorial note: This article is generated to provide a professional starting point, not a final verdict. The linked sources should be opened before making decisions, sharing claims, or using the topic in high-stakes contexts. That verification step is especially important for live sports, finance, politics, health, legal issues, celebrity news, and any story where early headlines can change within minutes.`,
    `Bottom line: ${cleanTitle} is currently worth watching because it has active search momentum and related source coverage. The strongest use of this briefing is to understand the topic's direction, identify what needs verification, and follow the linked sources for the newest confirmed details.`
  ];
}

async function backfillExistingPosts() {
  const posts = await readJson(paths.posts, []);
  const force = globalThis.process?.argv?.includes("--force");
  const upgraded = posts.map((post) => {
    const trend = {
      title: post.trend || post.title,
      category: post.category && post.category !== "Trends" ? post.category : classifyTopic(post.trend || post.title),
      traffic: extractTraffic(post.content || [])
    };

    return {
      ...post,
      title: shouldRefreshTitle(post, trend) ? headlineFor(trend.title) : post.title,
      category: trend.category,
      excerpt: post.excerpt && post.excerpt.length > 100 ? post.excerpt : professionalExcerpt(trend),
      image: imageForPost(trend),
      content: !force && Array.isArray(post.content) && wordCount(post.content) >= 750 ? post.content : fallbackContent(trend, post.sources || []),
      generatedBy: post.generatedBy || "template"
    };
  });

  await writeFile(paths.posts, `${JSON.stringify(upgraded, null, 2)}\n`, "utf8");
  await writeDerivedSiteFiles(upgraded);
  console.log(`Backfilled ${upgraded.length} post(s).`);
}

async function writeDerivedSiteFiles(posts) {
  const sorted = [...posts].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await mkdir(paths.postDataDir, { recursive: true });
  await mkdir(paths.postPagesDir, { recursive: true });
  await cleanGeneratedDirectory(paths.postDataDir, ".json");
  await cleanGeneratedDirectory(paths.postPagesDir, ".html");

  const metadata = sorted.map(postMetadata);
  await writeFile(paths.index, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  for (const post of sorted) {
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
    sourceCount: (post.sources || []).length,
    publishedAt: post.publishedAt,
    url: postUrl(post),
    readingTime: readingTime(post)
  };
}

function professionalExcerpt(trend) {
  return `A source-linked briefing on why ${trend.title} is gaining attention, what the available headlines suggest, and what readers should verify next.`;
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
  const image = library.find((item) => item.match.test(topic)) || library.find((item) => item.category === category) || library.find((item) => item.category === "Trends");

  const isRemote = /^https?:\/\//i.test(image.url);

  return {
    url: isRemote ? `${image.url}?auto=format&fit=crop&w=1400&q=82` : image.url,
    alt: `${titleCase(trend.title || "Trending topic")} related editorial image`,
    credit: image.credit || "AI-generated"
  };
}

function imageLibrary() {
  return [
    { category: "Sports", match: /(cricket|csk|mi|nba|nfl|ufc|fight|soccer|league|match|game|makhachev|bayern|psg|lorient|munich)/, url: "assets/generated/ai-sports-arena.png", credit: "AI-generated" },
    { category: "Technology", match: /(ai|tech|iphone|google|microsoft|software|cyber|app)/, url: "assets/generated/ai-trending-editorial.png", credit: "AI-generated" },
    { category: "Business", match: /(stock|market|business|bank|crypto|bitcoin|earnings|inflation)/, url: "assets/generated/ai-trending-editorial.png", credit: "AI-generated" },
    { category: "Culture", match: /(movie|music|album|tv|trailer|festival|celebrity|review|sheep|book|novel|detective)/, url: "assets/generated/ai-culture-books.png", credit: "AI-generated" },
    { category: "News", match: /(election|court|president|minister|policy|senate|socialism|law|politics)/, url: "assets/generated/ai-civic-analysis.png", credit: "AI-generated" },
    { category: "Trends", match: /(trend|search|viral|internet|news)/, url: "assets/generated/ai-trending-editorial.png", credit: "AI-generated" }
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
      if (["csk", "mi", "ufc", "ipl", "nba", "nfl", "mlb", "psg"].includes(word.toLowerCase())) return word.toUpperCase();
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
      headers: { "user-agent": "TrendPulseDaily/1.0" }
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

function headlineFor(topic) {
  const clean = titleCase(topic);
  const patterns = [
    `${clean}: What to Watch Today`,
    `Why ${clean} Is Trending Right Now`,
    `${clean} Explained: Key Takeaways`,
    `Breaking Down ${clean}`,
    `${clean}: The Source-Linked Briefing`
  ];
  const index = createHash("sha256").update(slugify(topic)).digest()[0] % patterns.length;
  return patterns[index];
}

function shouldRefreshTitle(post, trend) {
  if (!post.title) return true;
  const stale = String(post.title).toLowerCase() === `${String(trend.title).toLowerCase()}: what to watch today`;
  return stale || post.title === post.title.toLowerCase();
}

function classifyTopic(topic) {
  const text = topic.toLowerCase();
  if (/(ai|tech|iphone|google|microsoft|tesla|nvidia|app|software|cyber)/.test(text)) return "Technology";
  if (/(stock|market|fed|inflation|crypto|bitcoin|earnings|bank)/.test(text)) return "Business";
  if (/(nba|nfl|mlb|soccer|cricket|ufc|game|cup|league|ipl|csk|makhachev|bayern|munich|psg|lorient)/.test(text)) return "Sports";
  if (/(movie|music|album|tv|netflix|celebrity|trailer|festival|book|novel|detective|sheep)/.test(text)) return "Culture";
  if (/(election|court|president|minister|law|policy|senate|socialism|politics)/.test(text)) return "News";
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
    <description>Automated trending-topic briefings with source links.</description>${items}
  </channel>
</rss>
`;
}

function buildSitemap(posts) {
  const urls = [
    { loc: `${config.siteUrl}/`, lastmod: new Date().toISOString() },
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
  const imageUrl = absoluteAssetUrl(post.image?.url);
  const published = new Date(post.publishedAt).toISOString();

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
        <span><strong>TrendPulse</strong><small>Daily intelligence</small></span>
      </a>
      <div class="nav-actions">
        <a href="../#archive">Archive</a>
        <a href="../rss.xml">RSS</a>
      </div>
    </nav>
    <section class="post-hero">
      <p class="eyebrow">${escapeHtml(post.category || "Trend")}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="lede">${escapeHtml(description)}</p>
      <div class="feature-meta">
        <time datetime="${escapeAttribute(published)}">${escapeHtml(new Date(post.publishedAt).toUTCString())}</time>
        <span>${escapeHtml(readingTime(post))} read</span>
        <span>${(post.sources || []).length} sources</span>
      </div>
    </section>
  </header>
  <main class="post-main">
    <article class="feature-article post-detail">
      <div class="post-body">
        ${post.image?.url ? `<figure class="feature-image"><img src="${escapeAttribute(pageAssetUrl(post.image.url))}" alt="${escapeAttribute(post.image.alt || `${post.title} image`)}" width="1400" height="788" fetchpriority="high"><figcaption>${escapeHtml(post.image.credit || "Editorial image")}</figcaption></figure>` : ""}
        ${(post.content || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n        ")}
      </div>
      <aside class="source-panel">
        <p class="category">Sources</p>
        <p>Primary links gathered by the automation for quick verification.</p>
        <ul class="source-list">
          ${(post.sources || []).slice(0, 8).map((source) => `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a></li>`).join("\n          ")}
        </ul>
      </aside>
    </article>
    ${related.length ? `<section class="related-posts" aria-labelledby="relatedTitle"><div class="section-head"><div><p class="eyebrow">Next reads</p><h2 id="relatedTitle">Related briefings</h2></div></div><div class="post-grid">${related.map(relatedCard).join("")}</div></section>` : ""}
  </main>
  <footer class="footer">
    <div>
      <p class="footer-brand"><img src="../assets/icons/site-logo.svg" alt="" width="40" height="40" aria-hidden="true"><strong>TrendPulse Daily</strong></p>
      <p>Automated posts are generated from public trend and news RSS feeds. Verify fast-moving stories from the linked sources before acting on them.</p>
    </div>
  </footer>
  <script src="../assets/post.js" defer></script>
</body>
</html>
`;
}

function relatedCard(post) {
  return `<article class="post-card"><a class="card-link" href="${escapeAttribute(`${post.slug}.html`)}">${post.image?.url ? `<img class="card-image" src="${escapeAttribute(pageAssetUrl(post.image.url))}" alt="${escapeAttribute(post.image.alt || `${post.title} image`)}" loading="lazy" width="640" height="400">` : ""}<span class="category">${escapeHtml(post.category || "Trend")}</span><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt || "")}</p><div class="card-meta"><time datetime="${escapeAttribute(post.publishedAt)}">${escapeHtml(new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</time><span>${escapeHtml(readingTime(post))}</span></div></a></article>`;
}

function articleSchema(post, canonical, imageUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.title,
    description: post.excerpt,
    datePublished: new Date(post.publishedAt).toISOString(),
    dateModified: new Date(post.publishedAt).toISOString(),
    mainEntityOfPage: canonical,
    image: imageUrl,
    author: { "@type": "Organization", name: config.blogName },
    publisher: {
      "@type": "Organization",
      name: config.blogName,
      logo: { "@type": "ImageObject", url: `${config.siteUrl}/assets/icons/icon-512.svg` }
    }
  };
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
