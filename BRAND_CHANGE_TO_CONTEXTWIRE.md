# Brand change: ContextWire

Use **ContextWire** as the new website name.

Recommended tagline: **Source-checked context**

Run these replacements across the repository:

- `TrendPulse Daily` -> `ContextWire`
- `TrendPulse` -> `ContextWire`
- `Daily intelligence` -> `Source-checked context`
- `TRENDPULSE DAILY` -> `CONTEXTWIRE`

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
SITE_URL="https://yourdomain.com"
```
