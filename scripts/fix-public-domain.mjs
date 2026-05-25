import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const target = (process.env.SITE_URL || "https://contextwire.online").replace(/\/+$/, "");
const oldBases = [
  "https://sattarwajith-boop.github.io/Blog-Website",
  "http://sattarwajith-boop.github.io/Blog-Website",
  "https://sattarwajith-boop.github.io/Blog-Website/",
  "http://sattarwajith-boop.github.io/Blog-Website/",
  "https%3A%2F%2Fsattarwajith-boop.github.io%2FBlog-Website",
  "http%3A%2F%2Fsattarwajith-boop.github.io%2FBlog-Website",
  "https%3A%2F%2Fsattarwajith-boop.github.io%2FBlog-Website%2F",
  "http%3A%2F%2Fsattarwajith-boop.github.io%2FBlog-Website%2F"
];
const ignoredDirs = new Set([".git", "node_modules", "scripts", ".github"]);
const allowed = new Set([".html", ".json", ".xml", ".txt", ".webmanifest"]);

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
    for (const oldBase of oldBases) {
      const replacement = oldBase.includes("%2F") ? encodeURIComponent(target) : target;
      after = after.replaceAll(oldBase.replace(/\/+$/, ""), replacement);
    }
    after = after.replaceAll(`${target}//`, `${target}/`);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
      console.log(`Updated domain in ${file.pathname.replace(root.pathname, "")}`);
    }
  }

  console.log(`Public domain cleanup complete. Updated ${changed} file(s).`);
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
