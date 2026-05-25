import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const measurementId = process.env.GA_MEASUREMENT_ID || "G-EW36M38LS9";
const ignoredDirs = new Set([".git", "node_modules", "scripts", ".github"]);

const tag = `<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${measurementId}');
  </script>`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await collect(root);
  let changed = 0;

  for (const file of files) {
    const before = await readFile(file, "utf8");
    if (before.includes(measurementId)) continue;
    const after = before.replace(/<head>\s*/i, (match) => `${match}  ${tag}\n  `);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
      console.log(`Added Analytics to ${file.pathname.replace(root.pathname, "")}`);
    }
  }

  console.log(`Analytics cleanup complete. Updated ${changed} file(s).`);
}

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) out.push(...await collect(new URL(`${entry.name}/`, dir)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(new URL(entry.name, dir));
    }
  }
  return out;
}
