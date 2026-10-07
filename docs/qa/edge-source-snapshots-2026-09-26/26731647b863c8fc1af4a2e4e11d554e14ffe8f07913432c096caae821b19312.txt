import { createClient } from "@supabase/supabase-js";

/**
 * Validates the cron header against the encrypted Supabase Vault value.
 * The verifier RPC is service-role-only and fails closed on any database error.
 */
export async function isCronRequest(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<boolean> {
  const providedSecret = req.headers.get("x-agvlog-cron-secret");
  if (!providedSecret) return false;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("verify_agvlog_cron_secret", {
    p_secret: providedSecret,
  });
  return !error && data === true;
}
