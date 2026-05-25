process.env.BLOG_NAME = process.env.BLOG_NAME || "ContextWire";
process.env.NEW_BRAND_LONG = process.env.NEW_BRAND_LONG || "ContextWire";
process.env.NEW_BRAND_SHORT = process.env.NEW_BRAND_SHORT || "ContextWire";
process.env.SITE_URL = process.env.SITE_URL || "https://contextwire.online";

await import("./generate-posts.mjs");
await import("./upgrade-quality.mjs");
await import("./remove-quality-score.mjs");
await import("./fix-public-brand.mjs");
await import("./fix-public-domain.mjs");
await import("./fix-analytics.mjs");
await import("./audit-images.mjs");
await import("./check-brand.mjs");
