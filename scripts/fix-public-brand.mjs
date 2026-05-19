import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const ignoredDirs = new Set([".git", "node_modules", "scripts", ".github"]);
const allowed = new Set([".html", ".json", ".xml", ".txt", ".webmanifest", ".svg"]);

const replacements = [
  ["TrendPulse Daily", "ContextWire"],
  ["TrendPulse", "ContextWire"],
  ["Daily intelligence", "Source-checked context"],
  ["TRENDPULSE DAILY", "CONTEXTWIRE"],
  ["TrendPulseDaily/1.0", "ContextWire/1.0"],
  ["Sharp trend briefings for readers who want context quickly, without the noise.", "Clear source-checked briefings for readers who want context quickly, without the noise."],
  ["Built for concise trend context and fast topic discovery.", "Built for clear context, source checks, and practical topic discovery."],
  ["Trend briefings with concise context and daily updates.", "Context briefings with source checks and practical updates."]
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await collect(root);
  let changed = 0;

  for (const file of files) {
    const before = await readFile(file, "utf8");
    let after = before;
    for (const [from, to] of replacements) after = after.replaceAll(from, to);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
      console.log(`Updated brand in ${file.pathname.replace(root.pathname, "")}`);
    }
  }

  console.log(`Public brand cleanup complete. Updated ${changed} file(s).`);
}

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
