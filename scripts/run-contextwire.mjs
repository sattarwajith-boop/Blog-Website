process.env.BLOG_NAME = process.env.BLOG_NAME || "ContextWire";
process.env.NEW_BRAND_LONG = process.env.NEW_BRAND_LONG || "ContextWire";
process.env.NEW_BRAND_SHORT = process.env.NEW_BRAND_SHORT || "ContextWire";

await import("./generate-posts.mjs");
await import("./upgrade-quality.mjs");
await import("./remove-quality-score.mjs");
await import("./check-brand.mjs");
