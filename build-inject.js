// Runs as Netlify's build command (see netlify.toml). Takes
// index.template.html, swaps the __SUPABASE_URL__ / __SUPABASE_ANON_KEY__
// tokens for the real values from Netlify's env vars, and writes the
// result to public/index.html — the actual file that gets served.
//
// Why this exists: a plain static HTML file has no way to read
// process.env at runtime (that's a Node-only concept, browsers don't have
// it). Netlify Functions can read env vars directly because they're real
// Node processes; the frontend can't. This build step is what makes
// "just set it as an env var" actually work for the static page too —
// the swap happens once, at build time, before the browser ever sees it.
const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "index.template.html");
const outDir = path.join(__dirname, "public");
const outPath = path.join(outDir, "index.html");

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    `⚠️  Missing env var(s) at build time: ${missing.join(", ")}. ` +
    `The deployed app will show its own "not configured" banner until these are set in Netlify → Environment variables and the site is redeployed.`
  );
}

let html = fs.readFileSync(templatePath, "utf8");
html = html
  .replaceAll("__SUPABASE_URL__", process.env.SUPABASE_URL || "__SUPABASE_URL__")
  .replaceAll("__SUPABASE_ANON_KEY__", process.env.SUPABASE_ANON_KEY || "__SUPABASE_ANON_KEY__");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html);
console.log("✅ Injected Supabase config into public/index.html");
