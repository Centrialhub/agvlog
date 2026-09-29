export const PRODUCTION_SUPABASE_ORIGIN = "https://qcvnsdrbcchaxvawcngk.supabase.co";

export function assertHostedStagingSupabaseUrl(value) {
  if (!value) throw new Error("Hosted E2E requires a staging Supabase URL.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Hosted E2E Supabase URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/"
    || url.search || url.hash) {
    throw new Error("Hosted E2E requires an HTTPS Supabase origin without credentials, path or query.");
  }
  if (url.hostname.replace(/\.+$/, "") === new URL(PRODUCTION_SUPABASE_ORIGIN).hostname) {
    throw new Error("Hosted E2E must not target the production Supabase project.");
  }
  return url.origin;
}

export function assertReleaseSupabaseOrigin(releaseMetadata, expectedUrl) {
  if (!expectedUrl) throw new Error("Expected Supabase URL is required for release verification.");
  let expectedOrigin;
  try {
    expectedOrigin = new URL(expectedUrl).origin;
  } catch {
    throw new Error("Expected Supabase URL is invalid.");
  }
  if (!/^https?:\/\//.test(expectedOrigin)) throw new Error("Expected Supabase URL is invalid.");
  if (!releaseMetadata?.supabaseOrigin || releaseMetadata.supabaseOrigin !== expectedOrigin) {
    throw new Error("Release Supabase origin is absent or differs from the configured backend.");
  }
  return expectedOrigin;
}
