# Brand change: ContextWire

Use **ContextWire** as the new website name.

Recommended tagline: **Source-checked context**

Run the public brand cleanup script instead of doing manual replacements:

```bash
node scripts/fix-public-brand.mjs
```

The script keeps public output on the **ContextWire** name, tagline, and logo language.

Important files to update:

- `index.html`
- `about.html`
- `contact.html`
- `privacy.html`
- `terms.html`
- `editorial-policy.html`
- `site.webmanifest`
- `rss.xml`
- `data/index.json`
- `data/posts.json`
- `data/posts/*.json`
- `posts/*.html`
- `scripts/generate-posts.mjs`
- `scripts/upgrade-quality.mjs`

For future generated posts, run with:

```bash
BLOG_NAME="ContextWire" node scripts/generate-posts.mjs
BLOG_NAME="ContextWire" node scripts/upgrade-quality.mjs
```

For the custom domain, also set:

```bash
SITE_URL="https://contextwire.online"
```
