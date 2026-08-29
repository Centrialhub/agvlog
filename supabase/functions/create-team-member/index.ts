import { createClient } from "@supabase/supabase-js";
import { appOrigin, corsHeaders } from "../_shared/cors.ts";

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

    // Verify the calling user via their JWT
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with caller's JWT to verify identity
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tenant_id, email, full_name, role } = body;

    if (!tenant_id || !email || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: tenant_id, email, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["admin", "operator", "driver"].includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role. Cliente externo deve ser cadastrado via client_portal_access." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(
        JSON.stringify({ error: "Invalid email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin client to verify caller is tenant admin and create user
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
        JSON.stringify({ error: "Not authorized. Admin invitation requires owner or admin role." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!appOrigin) {
      return new Response(
        JSON.stringify({ error: "AGVLOG_APP_ORIGIN is required to send secure invitations" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Authorize exactly one auth.users insertion. The database trigger rejects
    // public signups and only accepts this short-lived, unguessable invite nonce.
    const inviteNonce = crypto.randomUUID();
    const { error: authorizationError } = await adminClient.rpc("prepare_auth_invite", {
      _email: normalizedEmail,
      _tenant_id: tenant_id,
      _invited_by: caller.id,
      _nonce: inviteNonce,
    });

    if (authorizationError) {
      return new Response(
        JSON.stringify({ error: "Unable to authorize invitation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Invite the user so only the recipient chooses the initial password.
    const { data: newUser, error: createError } =
      await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: {
          full_name: String(full_name || normalizedEmail).trim(),
          agvlog_invite_nonce: inviteNonce,
        },
        redirectTo: new URL("/set-password", appOrigin).toString(),
      });

    // This is a no-op when the trigger consumed the nonce. It closes the
    // authorization window immediately when Auth failed before inserting.
    await adminClient.rpc("cancel_auth_invite", {
      _email: normalizedEmail,
      _nonce: inviteNonce,
    });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create tenant membership
    const { error: memberError } = await adminClient
      .from("tenant_memberships")
      .insert({
        tenant_id,
        user_id: newUser.user.id,
        role,
        active: true,
      });

    if (memberError) {
      await adminClient.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: memberError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        invited: true,
        user_id: newUser.user.id,
        email: newUser.user.email,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
