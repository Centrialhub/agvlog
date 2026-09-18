export type PublicRuntimeConfigIssue =
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "missing_supabase_publishable_key";

function configuredValue(environment: Record<string, unknown>, name: string) {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}

function validSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    return (url.protocol === "https:" || localHttp)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function publicRuntimeConfigIssues(environment: Record<string, unknown>): PublicRuntimeConfigIssue[] {
  const issues: PublicRuntimeConfigIssue[] = [];
  const supabaseUrl = configuredValue(environment, "VITE_SUPABASE_URL");
  const publishableKey = configuredValue(environment, "VITE_SUPABASE_PUBLISHABLE_KEY");

  if (!supabaseUrl) issues.push("missing_supabase_url");
  else if (!validSupabaseUrl(supabaseUrl)) issues.push("invalid_supabase_url");
  if (!publishableKey) issues.push("missing_supabase_publishable_key");

  return issues;
}
