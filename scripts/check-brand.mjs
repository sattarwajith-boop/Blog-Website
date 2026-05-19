import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const banned = ["TrendPulse Daily", "Daily intelligence", "TRENDPULSE DAILY"];
const ignoredDirs = new Set([".git", "node_modules", "scripts", ".github"]);
const allowed = new Set([".html", ".json", ".xml", ".txt", ".webmanifest", ".svg"]);

const files = await collect(root);
const hits = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const phrase of banned) {
    if (text.includes(phrase)) {
      hits.push(`${file.pathname.replace(root.pathname, "")}: ${phrase}`);
    }
  }
}

if (hits.length) {
  console.error("Old public brand text still exists:\n" + hits.join("\n"));
  process.exit(1);
}

console.log("Public brand check passed: ContextWire is clean.");

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) out.push(...await collect(new URL(`${entry.name}/`, dir)));
    } else if (entry.isFile() && allowed.has(ext(entry.name))) {
      out.push(new URL(entry.name, dir));
    }
  }
  return out;
}

function ext(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index);
}
