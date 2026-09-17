import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tenant_id, user_id, full_name, email, password, action } = body;

    if (!tenant_id || !user_id) {
      return new Response(
        JSON.stringify({ error: "Missing tenant_id or user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password !== undefined) {
      return new Response(
        JSON.stringify({ error: "Administrators cannot set another user's password" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (email !== undefined) {
      return new Response(
        JSON.stringify({ error: "Tenant administrators cannot change a user's global login email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is admin of this tenant
    const { data: membership } = await adminClient
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", caller.id)
      .eq("tenant_id", tenant_id)
      .eq("active", true)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Not authorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify target user belongs to this tenant
    const { data: targetMembership } = await adminClient
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", user_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!targetMembership) {
      return new Response(
        JSON.stringify({ error: "User is not a member of this tenant" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "send_password_reset") {
      const { data: target, error: targetError } = await adminClient.auth.admin.getUserById(user_id);
      if (targetError || !target.user?.email) {
        return new Response(JSON.stringify({ error: targetError?.message || "User email not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const appOrigin = Deno.env.get("AGVLOG_APP_ORIGIN")?.replace(/\/$/, "") || "https://agvlog.lovable.app";
      const publicClient = createClient(supabaseUrl, anonKey);
      const { error: resetError } = await publicClient.auth.resetPasswordForEmail(target.user.email, {
        redirectTo: `${appOrigin}/set-password`,
      });
      if (resetError) {
        return new Response(JSON.stringify({ error: resetError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update profile name if provided
    if (full_name && full_name.trim()) {
      const { data: updatedProfile, error: profileError } = await adminClient
        .from("profiles")
        .update({ full_name: full_name.trim(), updated_at: new Date().toISOString() })
        .eq("id", user_id)
        .select("id")
        .maybeSingle();
      if (profileError || !updatedProfile) {
        return new Response(
          JSON.stringify({ error: profileError?.message || "Profile was not updated" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
