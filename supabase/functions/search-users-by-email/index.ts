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
    const query: string = (body.query || "").toString().trim().toLowerCase();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) {
      return json({ error: "Informe o e-mail completo do usuário" }, 400);
    }

    const admin = createClient(url, service);

    // Verifica que o caller é owner/admin do tenant.
    const { data: membership } = await admin
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", tenant_id)
      .eq("active", true)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    // Exact-email lookup prevents broad enumeration. A matched account is only
    // disclosed when it is not attached to any tenant yet or already belongs to
    // the requested tenant. This blocks cross-tenant identity disclosure.
    const matches: Array<{ id: string; email: string | null; full_name: string | null }> = [];
    const perPage = 100;
    const maxPages = 10;
    for (let page = 1; page <= maxPages && matches.length === 0; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      for (const u of data.users) {
        const email = u.email?.toLowerCase() ?? "";
        if (email === query) {
          const [{ data: memberships }, { data: portalAccess }] = await Promise.all([
            admin
              .from("tenant_memberships")
              .select("tenant_id")
              .eq("user_id", u.id)
              .eq("active", true),
            admin
              .from("client_portal_access")
              .select("tenant_id")
              .eq("user_id", u.id)
              .eq("active", true),
          ]);
          const relatedTenantIds = new Set([
            ...(memberships ?? []).map((row) => String(row.tenant_id)),
            ...(portalAccess ?? []).map((row) => String(row.tenant_id)),
          ]);
          if (relatedTenantIds.size === 0 || relatedTenantIds.has(tenant_id)) {
            const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
            const fullName = typeof meta.full_name === "string"
              ? meta.full_name
              : typeof meta.name === "string"
              ? meta.name
              : null;
            matches.push({
              id: u.id,
              email: u.email ?? null,
              full_name: fullName,
            });
          }
          break;
        }
      }
      if (data.users.length < perPage) break;
    }

    return json({ users: matches });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
