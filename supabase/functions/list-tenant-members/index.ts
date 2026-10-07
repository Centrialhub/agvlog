import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Invalid token" }, 401);

    const body = await req.json().catch(() => ({}));
    const tenant_id: string | undefined = body.tenant_id;
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const admin = createClient(url, service);

    const { data: membership } = await admin
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", tenant_id)
      .eq("active", true)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    const memberships: Array<{ user_id: string; active: boolean }> = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await admin.from("tenant_memberships").select("user_id,active")
        .eq("tenant_id", tenant_id).order("user_id").range(from, from + 499);
      if (error) return json({ error: error.message }, 500);
      memberships.push(...(data || []));
      if ((data?.length || 0) < 500) break;
    }

    const ids = [...new Set((memberships || []).map((m) => m.user_id))];
    const activeIds = new Set((memberships || []).filter(m => m.active).map(m => m.user_id));
    const users: Array<{ id: string; email: string | null; full_name: string | null }> = [];
    const retiredUserIds: string[] = [];

    // Memberships already provide the authoritative IDs. Resolve those users
    // directly instead of scanning a capped prefix of the global auth catalog.
    const batchSize = 25;
    for (let index = 0; index < ids.length; index += batchSize) {
      const batch = ids.slice(index, index + batchSize);
      const results = await Promise.all(batch.map((id) => admin.auth.admin.getUserById(id)));
      for (const [offset, result] of results.entries()) {
        if (result.error) {
          if (!activeIds.has(batch[offset]) && result.error.status === 404) {
            retiredUserIds.push(batch[offset]);
            continue;
          }
          return json({ error: result.error.message }, 500);
        }
        const u = result.data.user;
        if (u && ((u as typeof u & { deleted_at?: string }).deleted_at || u.app_metadata?.driver_access_retired === true)) {
          retiredUserIds.push(u.id);
          continue;
        }
        if (u) {
          const meta = u.user_metadata || {};
          users.push({
            id: u.id,
            email: u.email ?? null,
            full_name: (meta.full_name || meta.name) ?? null,
          });
        }
      }
    }

    return json({ users, retired_user_ids: retiredUserIds });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
