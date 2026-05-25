import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const postsPath = new URL("data/posts.json", root);
const reportPath = new URL("IMAGE_AUDIT_REPORT.md", root);

const specificTopicPatterns = [
  { type: "product", pattern: /\b(iphone|ipad|macbook|apple|samsung|galaxy|nothing phone|pixel|oneplus|xiaomi|laptop|tablet|earbuds|watch|tesla|nvidia|playstation|xbox)\b/i },
  { type: "movie-tv", pattern: /\b(movie|trailer|poster|netflix|disney|hbo|prime video|series|season|episode|finale|the boys|south park|lanterns|marvel|dc|studio)\b/i },
  { type: "person", pattern: /\b(actor|actress|singer|rapper|celebrity|player|president|minister|ceo|rory|bruno|affleck|zegler|seacrest|mcilroy|sinner|medvedev)\b/i },
  { type: "sports-event", pattern: /\b(vs|match|game|nba|nfl|mlb|ufc|ipl|cricket|soccer|football|tennis|golf|playoffs|standings|league|cup)\b/i },
  { type: "company-news", pattern: /\b(stock|earnings|shares|market|nasdaq|ford|smci|dram|micron|bank|finance|company)\b/i }
];

const genericImagePatterns = [
  /images\.unsplash\.com/i,
  /assets\/generated\//i,
  /contextwire editorial graphic/i,
  /generic/i,
  /stock/i
];

const posts = await readJson(postsPath, []);
const findings = [];

for (const post of posts) {
  const text = [post.title, post.trend, post.category, post.excerpt, ...(post.tags || [])].filter(Boolean).join(" ");
  const matchedType = specificTopicPatterns.find((item) => item.pattern.test(text));
  if (!matchedType) continue;

  const imageUrl = post.image?.url || "";
  const imageCredit = post.image?.credit || "";
  const hasSourceUrl = Boolean(post.image?.sourceUrl || post.image?.source || post.image?.source_url);
  const looksGeneric = genericImagePatterns.some((pattern) => pattern.test(`${imageUrl} ${imageCredit}`));

  if (looksGeneric || !hasSourceUrl) {
    findings.push({
      title: post.title || post.trend || "Untitled post",
      slug: post.slug || "",
      type: matchedType.type,
      imageUrl,
      imageCredit,
      issue: looksGeneric ? "generic image for specific topic" : "missing image source URL",
      recommended: recommendationFor(matchedType.type)
    });
  }
}

await writeFile(reportPath, buildReport(findings), "utf8");
console.log(`Image audit complete. ${findings.length} issue(s) found.`);
if (findings.length) console.log("See IMAGE_AUDIT_REPORT.md");

function recommendationFor(type) {
  const map = {
    product: "Use an official product image, original photo, product screenshot, or company media-kit image. Add credit and sourceUrl.",
    "movie-tv": "Use official poster/key art, an official trailer still, or an original editorial graphic. Add credit and sourceUrl.",
    person: "Use a licensed/official image, public profile embed, or original editorial graphic. Avoid unlicensed news-agency photos.",
    "sports-event": "Use official league/team/event image, licensed photo, scoreboard/schedule screenshot, or original editorial graphic.",
    "company-news": "Use official company media image, filing/chart screenshot you created, or original editorial graphic."
  };
  return map[type] || "Use a directly relevant image with credit and sourceUrl.";
}

function buildReport(findings) {
  const lines = [
    "# ContextWire image audit report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This report flags posts where a specific topic may still be using a generic image or missing source metadata.",
    "",
    `Total issues: ${findings.length}`,
    ""
  ];

  if (!findings.length) {
    lines.push("No image issues found by the current audit rules.", "");
    return lines.join("\n");
  }

  for (const item of findings) {
    lines.push(`## ${item.title}`);
    lines.push(`- Slug: \`${item.slug}\``);
    lines.push(`- Topic type: ${item.type}`);
    lines.push(`- Issue: ${item.issue}`);
    lines.push(`- Current credit: ${item.imageCredit || "missing"}`);
    lines.push(`- Current image: ${item.imageUrl || "missing"}`);
    lines.push(`- Recommended fix: ${item.recommended}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
