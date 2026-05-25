# ContextWire

A static ContextWire publishing site for source-checked long-form briefings from current internet trend feeds.

## What it does

- Fetches Google Trends Trending Now RSS by default.
- Looks up related Google News RSS headlines for source context.
- Creates new posts in `data/posts.json`.
- Upgrades posts into 900+ word reader-first articles with visible source notes.
- Rebuilds `rss.xml` and `sitemap.xml`.
- Runs from GitHub Actions twice per day.
- Works without paid APIs. If you add the optional writing API key, it can create richer post copy while still using the fetched sources.

## One-time setup

1. Create a new GitHub repository and upload this `trending-auto-blog` folder.
2. In the repository, open **Settings > Pages** and publish from the default branch root.
3. In **Settings > Actions > General**, allow GitHub Actions to read and write repository contents.
4. Set repository variable `SITE_URL` to `https://contextwire.online` or let the workflows use that default.
5. Optional: add the writing API secret and model variable if you want richer long-form writing.
6. Open **Actions > Publish ContextWire briefings > Run workflow** for the first test.

The workflow is scheduled at 8:15 AM and 6:15 PM Asia/Colombo time. Change the publishing workflow if you want different times or more runs per day.

## Local test

```bash
npm run check
npm run generate
```

For production-style cleanup, run:

```bash
SITE_URL=https://contextwire.online BLOG_NAME=ContextWire node scripts/upgrade-quality.mjs
node scripts/remove-quality-score.mjs
node scripts/fix-public-brand.mjs
SITE_URL=https://contextwire.online node scripts/fix-public-domain.mjs
node scripts/fix-analytics.mjs
node scripts/audit-images.mjs
node scripts/check-brand.mjs
```

Open `index.html` in your browser to preview. After generation, the newest post appears as the featured article.

## Useful settings

- `POSTS_PER_RUN`: how many posts to publish per scheduled run. Default: `2`.
- `MAX_POSTS`: how many posts to keep in `data/posts.json`. Default: `160`.
- `BLOG_REGION`: Google Trends region. Default: `US`.
- `BLOG_LANGUAGE`: feed language. Default: `en-US`.
- `TREND_RSS_URLS`: comma-separated RSS feed URLs if you want custom feeds.

## Editorial note

Trend posts should be treated as editorial briefings. The scripts include source links and avoid unsupported claims, but fast-moving stories should still be checked before promotion, indexing, or monetization review.
