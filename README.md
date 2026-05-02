# TrendPulse Daily

A static blogging website that can publish one or more posts every day from current internet trend feeds.

## What it does

- Fetches Google Trends Trending Now RSS by default.
- Looks up related Google News RSS headlines for source context.
- Creates new posts in `data/posts.json`.
- Rebuilds `rss.xml` and `sitemap.xml`.
- Runs automatically from GitHub Actions twice per day.
- Works without paid APIs. If you add `OPENAI_API_KEY`, it can generate richer post copy while still using the fetched sources.

## One-time setup

1. Create a new GitHub repository and upload this `trending-auto-blog` folder.
2. In the repository, open **Settings > Pages** and publish from the default branch root.
3. In **Settings > Actions > General**, allow GitHub Actions to read and write repository contents.
4. Optional: add repository variable `SITE_URL` with your final GitHub Pages or custom-domain URL.
5. Optional: add repository secret `OPENAI_API_KEY` and repository variable `OPENAI_MODEL` if you want AI-assisted writing.
6. Open **Actions > Auto publish trending posts > Run workflow** for the first test.

The workflow is scheduled at 8:15 AM and 6:15 PM Asia/Colombo time. Change `.github/workflows/auto-post.yml` if you want different times or more runs per day.

## Local test

```bash
npm run check
npm run generate
```

Open `index.html` in your browser to preview. After generation, the newest post appears as the featured article.

## Useful settings

- `POSTS_PER_RUN`: how many posts to publish per automation run. Default: `2`.
- `MAX_POSTS`: how many posts to keep in `data/posts.json`. Default: `160`.
- `BLOG_REGION`: Google Trends region. Default: `US`.
- `BLOG_LANGUAGE`: feed language. Default: `en-US`.
- `TREND_RSS_URLS`: comma-separated RSS feed URLs if you want custom feeds.

## Editorial note

Automated trend posts should be treated as briefings. The script includes source links and avoids unsupported claims, but fast-moving stories should still be checked before promotion.
