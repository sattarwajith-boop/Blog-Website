# Run the AdSense quality upgrade

After your normal post generation, run this command locally or in your workflow:

```bash
node scripts/upgrade-quality.mjs
```

Recommended full workflow:

```bash
node scripts/generate-posts.mjs
node scripts/upgrade-quality.mjs
```

For your custom domain, run with your real domain:

```bash
SITE_URL=https://yourdomain.com node scripts/generate-posts.mjs
SITE_URL=https://yourdomain.com node scripts/upgrade-quality.mjs
```

This adds stronger article structure, visible source sections, quality notes, robots.txt updates, and an AdSense checklist.
