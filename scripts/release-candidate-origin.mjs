import { assertHostedStagingSupabaseUrl, assertReleaseSupabaseOrigin } from "./release-backend-identity.mjs";

const immutableHost = /^agvlogistica-[a-z0-9]{9}-centrialhubs-projects\.vercel\.app$/;

export function assertImmutableCandidateOrigin(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Candidate URL is invalid.");
  }

  // The hosted test receives staging credentials. Reject aliases and arbitrary
  // hosts even if they redirect to a real deployment.
  if (url.protocol !== "https:" || !immutableHost.test(url.hostname)
    || url.username || url.password || url.port || url.pathname !== "/"
    || url.search || url.hash || (candidate !== url.origin && candidate !== `${url.origin}/`)) {
    throw new Error("Candidate URL must be an HTTPS immutable deployment URL for the agvlogistica Vercel project.");
  }

  return url.origin;
}

export function isImmutableCandidateOrigin(candidate) {
  try {
    assertImmutableCandidateOrigin(candidate);
    return true;
  } catch {
    return false;
  }
}

export function candidateBypassHeaders(candidate, secret, { cookie = false } = {}) {
  assertImmutableCandidateOrigin(candidate);
  if (!secret) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for a protected candidate.");
  return {
    "x-vercel-protection-bypass": secret,
    ...(cookie ? { "x-vercel-set-bypass-cookie": "true" } : {}),
  };
}

export async function obtainCandidateBypassState(candidate, secret, requestFactory, {
  expectedSupabaseUrl, expectedRelease,
} = {}) {
  const origin = assertImmutableCandidateOrigin(candidate);
  if (!expectedRelease) throw new Error("Expected release SHA is required for hosted Preview E2E.");
  assertHostedStagingSupabaseUrl(expectedSupabaseUrl);
  const context = await requestFactory.newContext();
  try {
    // Keep the secret on one request to the approved origin. Do not follow a
    // redirect, since that could forward the header to an unrelated host.
    const response = await context.get(new URL("/release.json", origin).href, {
      headers: candidateBypassHeaders(origin, secret, { cookie: true }),
      maxRedirects: 0,
      timeout: 15_000,
    });
    if (!response.ok()) {
      throw new Error(`Protected Preview authentication returned HTTP ${response.status()}.`);
    }
    const releaseMetadata = await response.json();
    if (releaseMetadata?.release !== expectedRelease) {
      throw new Error("Hosted Preview release SHA differs from the selected candidate.");
    }
    assertReleaseSupabaseOrigin(releaseMetadata, expectedSupabaseUrl);

    const host = new URL(origin).hostname;
    const state = await context.storageState();
    const cookies = state.cookies
      .filter(({ domain }) => {
        const cookieDomain = domain.replace(/^\./, "");
        return cookieDomain === host || host.endsWith(`.${cookieDomain}`);
      })
      .map((cookie) => ({ ...cookie, domain: host }));
    if (cookies.length === 0) {
      throw new Error("Protected Preview did not return a browser bypass cookie.");
    }
    // A host-only cookie lets browser requests load the Preview without a
    // global Playwright header that would also reach Supabase or other hosts.
    return { cookies, origins: [] };
  } finally {
    await context.dispose();
  }
}
