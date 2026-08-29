import { randomBytes } from "node:crypto";

const target = process.env.DEPLOY_SMOKE_URL;
if (!target) throw new Error("DEPLOY_SMOKE_URL is required for a deployed smoke test.");
const origin = new URL(target).origin;

const page = await fetch(origin, { redirect: "follow" });
if (!page.ok) throw new Error(`Frontend returned HTTP ${page.status}`);

const requiredHeaders = {
  "content-security-policy": /default-src 'self'/,
  "strict-transport-security": /max-age=/,
  "x-content-type-options": /^nosniff$/i,
  "x-frame-options": /^DENY$/i,
  "referrer-policy": /strict-origin-when-cross-origin/,
  "permissions-policy": /microphone=\(\)/,
};
for (const [name, expected] of Object.entries(requiredHeaders)) {
  const value = page.headers.get(name) ?? "";
  if (!expected.test(value)) throw new Error(`Missing or invalid ${name}: ${value || "<absent>"}`);
}

const html = await page.text();
if (/sb_secret_|service_role|BEGIN [A-Z ]*PRIVATE KEY/i.test(html)) {
  throw new Error("Recognized secret marker found in deployed HTML.");
}
const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map((match) => match[1]);
for (const scriptPath of scriptPaths.slice(0, 5)) {
  const scriptUrl = new URL(scriptPath, origin);
  const script = await fetch(scriptUrl);
  if (!script.ok) throw new Error(`Deployed chunk unavailable: ${scriptUrl}`);
  const source = await script.text();
  if (/sourceMappingURL=|sb_secret_|BEGIN [A-Z ]*PRIVATE KEY/i.test(source)) {
    throw new Error(`Unsafe marker in deployed chunk: ${scriptUrl}`);
  }
  const sourceMap = await fetch(`${scriptUrl}.map`);
  if (sourceMap.ok) throw new Error(`Public source map is reachable: ${scriptUrl}.map`);
}

const supabaseUrl = process.env.DEPLOY_SUPABASE_URL;
const publishableKey = process.env.DEPLOY_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) throw new Error("Hosted Auth smoke variables are required.");
const signup = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: publishableKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: `public-signup-probe-${Date.now()}@agvlog-e2e.invalid`,
    password: `${randomBytes(24).toString("base64url")}Aa1!`,
  }),
});
if (signup.ok) {
  throw new Error("CRITICAL: hosted public signup accepted the probe; revoke the created test identity and disable signup.");
}

console.log(`Deployment smoke passed for ${origin}; hosted signup rejected with HTTP ${signup.status}.`);
