# AdSense readiness checklist

This repository now includes a ContextWire quality-upgrade layer for reader-first posts.

## Before applying

- Set the real custom domain in GitHub Pages.
- Run the generator with `SITE_URL=https://yourdomain.com` so sitemap, RSS, canonical URLs, and robots.txt use your real domain.
- Review at least 20 to 30 articles manually before applying.
- Open several live posts in incognito and confirm the source boxes are visible.
- Replace weak posts that have only one source or generic information.
- Add Google Search Console and submit `/sitemap.xml`.
- Add `ads.txt` only after AdSense gives your real publisher ID.

## Recommended publishing workflow

1. Let automation create the draft.
2. Run the ContextWire quality workflow, or locally run `SITE_URL=https://contextwire.online BLOG_NAME=ContextWire node scripts/upgrade-quality.mjs`.
3. Manually check facts and sources.
4. Publish only articles with real reader value.

Do not try to hide AI use. Improve the public quality so the site is useful to real readers.
