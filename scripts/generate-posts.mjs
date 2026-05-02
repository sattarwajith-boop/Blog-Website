import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = {
  blogName: process.env.BLOG_NAME || "TrendPulse Daily",
  region: process.env.BLOG_REGION || "US",
  language: process.env.BLOG_LANGUAGE || "en-US",
  postsPerRun: clampNumber(process.env.POSTS_PER_RUN, 1, 10, 2),
  maxPosts: clampNumber(process.env.MAX_POSTS, 20, 500, 160),
  siteUrl: trimSlash(process.env.SITE_URL || ""),
  openAiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
};

const paths = {
  posts: new URL("data/posts.json", root),
  topics: new URL("data/topics.json", root),
  rss: new URL("rss.xml", root),
  sitemap: new URL("sitemap.xml", root)
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
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
  await writeFile(paths.rss, buildRss(nextPosts), "utf8");
  await writeFile(paths.sitemap, buildSitemap(nextPosts), "utf8");

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
    excerpt: `A quick, sourced look at why "${trend.title}" is moving through today's search and news cycle.`,
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
      content: Array.isArray(aiPost.content) && aiPost.content.length ? aiPost.content.slice(0, 5) : base.content
    };
  } catch (error) {
    console.warn(`OpenAI generation failed for ${trend.title}: ${error.message}`);
    return base;
  }
}

async function generateWithOpenAI(trend, sources) {
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
          content: "Write concise, neutral blog briefs from provided trend and source titles. Do not invent facts. Return strict JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            trend: trend.title,
            category: trend.category,
            sourceTitles: sources.map((source) => source.title),
            requiredShape: {
              title: "string under 72 chars",
              excerpt: "string under 180 chars",
              content: ["3 to 5 short paragraphs, no unsupported claims"]
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
  const sourceNames = sources.slice(0, 3).map((source) => source.title);
  const sourceLine = sourceNames.length ? `Recent source headlines include: ${sourceNames.join("; ")}.` : "The topic is moving in trend feeds, but related source headlines were limited at generation time.";

  return [
    `${trend.title} is appearing in today's trend data${trend.traffic ? ` with reported search interest around ${trend.traffic}` : ""}. This post keeps the framing tight because fast-moving topics can change within hours.`,
    sourceLine,
    "The useful angle for readers is to watch what changes next: official confirmations, primary-source updates, market reaction, fan or consumer behavior, and whether the search spike continues after the first wave of attention.",
    "This automated brief is a starting point, not a final verdict. Open the sources before making decisions or sharing claims from a developing story."
  ];
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
  return `${topic}: what to watch today`;
}

function classifyTopic(topic) {
  const text = topic.toLowerCase();
  if (/(ai|tech|iphone|google|microsoft|tesla|nvidia|app|software|cyber)/.test(text)) return "Technology";
  if (/(stock|market|fed|inflation|crypto|bitcoin|earnings|bank)/.test(text)) return "Business";
  if (/(nba|nfl|mlb|soccer|cricket|ufc|game|cup|league)/.test(text)) return "Sports";
  if (/(movie|music|album|tv|netflix|celebrity|trailer|festival)/.test(text)) return "Culture";
  if (/(election|court|president|minister|law|policy|senate)/.test(text)) return "News";
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
      <guid>${xmlEscape(post.id)}</guid>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <description>${xmlEscape(post.excerpt)}</description>
    </item>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(config.blogName)}</title>
    <link>${xmlEscape(config.siteUrl || ".")}</link>
    <description>Automated trending-topic briefings with source links.</description>${items}
  </channel>
</rss>
`;
}

function buildSitemap(posts) {
  const urls = [
    `${config.siteUrl || "."}/`,
    ...posts.slice(0, 80).map((post) => postUrl(post))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n")}
</urlset>
`;
}

function postUrl(post) {
  return config.siteUrl ? `${config.siteUrl}/#${post.slug}` : `./#${post.slug}`;
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

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}
