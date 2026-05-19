import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const postsDir = new URL("posts/", root);
const cssFile = new URL("assets/quality-upgrades.css", root);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await htmlFiles(postsDir);
  let changed = 0;

  for (const file of files) {
    const before = await readFile(file, "utf8");
    const after = removeQualityScore(before);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
      console.log(`Removed quality score from ${file.pathname.replace(root.pathname, "")}`);
    }
  }

  await cleanCss();
  console.log(`Quality score cleanup complete. Updated ${changed} article page(s).`);
}

async function htmlFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => new URL(entry.name, directory));
  } catch {
    return [];
  }
}

function removeQualityScore(html) {
  return String(html)
    .replace(/\s*<div class="sidebar-block quality-score-block">[\s\S]*?<\/div>/gi, "")
    .replace(/\s*<div class='sidebar-block quality-score-block'>[\s\S]*?<\/div>/gi, "")
    .replace(/\s*<section class="sidebar-block quality-score-block">[\s\S]*?<\/section>/gi, "")
    .replace(/\s*<section class='sidebar-block quality-score-block'>[\s\S]*?<\/section>/gi, "");
}

async function cleanCss() {
  let css;
  try {
    css = await readFile(cssFile, "utf8");
  } catch {
    return;
  }

  const cleaned = css
    .replace(/,\s*\.quality-score-block strong/g, "")
    .replace(/\n\.quality-score-block strong \{[\s\S]*?\}\n?/g, "\n");

  if (cleaned !== css) {
    await writeFile(cssFile, cleaned, "utf8");
    console.log("Removed quality score CSS rules.");
  }
}
