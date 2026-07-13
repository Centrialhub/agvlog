import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { data: memberships, error: mErr } = await admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenant_id);
    if (mErr) return json({ error: mErr.message }, 500);

    const ids = new Set((memberships || []).map((m) => m.user_id));
    const users: Array<{ id: string; email: string | null; full_name: string | null }> = [];

    const perPage = 200;
    const maxPages = 20;
    for (let page = 1; page <= maxPages; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      for (const u of data.users) {
        if (ids.has(u.id)) {
          const meta = (u.user_metadata as any) || {};
          users.push({
            id: u.id,
            email: u.email ?? null,
            full_name: (meta.full_name || meta.name) ?? null,
          });
        }
      }
      if (data.users.length < perPage) break;
      if (users.length >= ids.size) break;
    }

    return json({ users });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});