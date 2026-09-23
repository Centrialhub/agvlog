import { randomBytes } from "node:crypto";

const target = process.env.DEPLOY_SMOKE_URL;
if (!target) throw new Error("DEPLOY_SMOKE_URL is required for a deployed smoke test.");
const targetUrl = new URL(target);
if (targetUrl.protocol !== "https:" && process.env.DEPLOY_SMOKE_ALLOW_HTTP !== "true") {
  throw new Error("DEPLOY_SMOKE_URL must use HTTPS.");
}
if (targetUrl.username || targetUrl.password) throw new Error("DEPLOY_SMOKE_URL must not contain credentials.");
const origin = targetUrl.origin;
const fetchOptions = () => ({ redirect: "error", signal: AbortSignal.timeout(15_000) });

const page = await fetch(origin, fetchOptions());
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

const expectedRelease = process.env.DEPLOY_EXPECTED_RELEASE;
if (!expectedRelease) throw new Error("DEPLOY_EXPECTED_RELEASE is required for immutable candidate verification.");
const releaseResponse = await fetch(new URL("/release.json", origin), fetchOptions());
if (!releaseResponse.ok) throw new Error(`Release metadata returned HTTP ${releaseResponse.status}`);
const releaseMetadata = await releaseResponse.json();
if (releaseMetadata?.release !== expectedRelease) {
  throw new Error(`Candidate release mismatch: expected ${expectedRelease}, received ${releaseMetadata?.release ?? "<absent>"}`);
}
const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map((match) => match[1]);
for (const scriptPath of new Set(scriptPaths)) {
  const scriptUrl = new URL(scriptPath, origin);
  if (scriptUrl.origin !== origin) throw new Error(`Unexpected cross-origin script: ${scriptUrl}`);
  const script = await fetch(scriptUrl, fetchOptions());
  if (!script.ok) throw new Error(`Deployed chunk unavailable: ${scriptUrl}`);
  const source = await script.text();
  if (/sourceMappingURL=|sb_secret_|BEGIN [A-Z ]*PRIVATE KEY/i.test(source)) {
    throw new Error(`Unsafe marker in deployed chunk: ${scriptUrl}`);
  }
  const sourceMap = await fetch(`${scriptUrl}.map`, fetchOptions());
  if (sourceMap.ok) {
    // SPA rewrites can return index.html with HTTP 200 for a missing .map path.
    // Only that HTML fallback is harmless; any other successful response is an
    // unexpected public artifact and must block the candidate.
    if (!sourceMap.headers.get("content-type")?.toLowerCase().includes("text/html")
      || await sourceMap.text() !== html) {
      throw new Error(`Public source map or unexpected artifact is reachable: ${scriptUrl}.map`);
    }
  }
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
  signal: AbortSignal.timeout(15_000),
});
if (signup.ok) {
  throw new Error("CRITICAL: hosted public signup accepted the probe; revoke the created test identity and disable signup.");
}
const signupBody = await signup.text();
if (signup.status < 400 || signup.status >= 500 || !/signup_disabled|signup.*disabled|signups?.*not allowed/i.test(signupBody)) {
  throw new Error(`Hosted signup was not rejected by the expected disabled-signup policy (HTTP ${signup.status}).`);
}

console.log(`Deployment smoke passed for ${origin} at release ${expectedRelease}; hosted signup is disabled.`);
