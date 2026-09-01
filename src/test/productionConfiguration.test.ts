import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("production configuration contract", () => {
  it("pins Edge Function dependencies per function", () => {
    const functionsRoot = join(root, "supabase", "functions");
    const functionNames = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .filter((entry) => {
        try {
          readFileSync(join(functionsRoot, entry.name, "index.ts"), "utf8");
          return true;
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name);

    expect(functionNames).toHaveLength(33);

    for (const name of functionNames) {
      const source = read("supabase", "functions", name, "index.ts");
      const denoConfig = JSON.parse(read("supabase", "functions", name, "deno.json"));

      expect(source).not.toMatch(/(?:https:\/\/esm\.sh\/|npm:)@supabase\/supabase-js/);
      expect(denoConfig.imports["@supabase/supabase-js"]).toBe(
        "npm:@supabase/supabase-js@2.108.2",
      );
      expect(denoConfig.imports["@supabase/supabase-js/cors"]).toBe(
        "npm:@supabase/supabase-js@2.108.2/cors",
      );
    }

    const sharedSources = [
      read("supabase", "functions", "_shared", "cron-auth.ts"),
      read("supabase", "functions", "_shared", "ssx-utils.ts"),
    ].join("\n");
    expect(sharedSources).not.toMatch(/(?:https:\/\/esm\.sh\/|npm:)@supabase\/supabase-js/);
  });

  it("keeps Edge Function CORS centralized and restricted to the production origin", () => {
    const functionsRoot = join(root, "supabase", "functions");
    const functionNames = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
    const functionSources = functionNames
      .map((name) => {
        try {
          return read("supabase", "functions", name, "index.ts");
        } catch {
          return "";
        }
      })
      .join("\n");
    const sharedCors = read("supabase", "functions", "_shared", "cors.ts");

    expect(functionSources).not.toMatch(/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
    expect(functionSources).not.toContain("@supabase/supabase-js/cors");
    expect(sharedCors).toContain('Deno.env.get("AGVLOG_APP_ORIGIN")');
    expect(sharedCors).toContain('const PRODUCTION_APP_ORIGIN = "https://agvlog.lovable.app"');
    expect(sharedCors).toContain("appOrigin ?");
    expect(sharedCors).not.toMatch(/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
  });

  it("keeps the B2B application invite-only", () => {
    const config = read("supabase", "config.toml");
    const authPage = read("src", "pages", "Auth.tsx");
    const setPasswordPage = read("src", "pages", "SetPassword.tsx");
    const createMember = read("supabase", "functions", "create-team-member", "index.ts");
    const updateMember = read("supabase", "functions", "update-team-member", "index.ts");
    const teamManagement = read("src", "pages", "TeamManagement.tsx");

    expect(config).toMatch(/\[auth\][\s\S]*?enable_signup = false/);
    expect(config).toMatch(/\[auth\.email\][\s\S]*?enable_signup = true/);
    expect(config).toContain("enable_anonymous_sign_ins = false");
    expect(config).toContain("minimum_password_length = 12");
    expect(config).toContain('password_requirements = "lower_upper_letters_digits"');
    expect(config).toContain("[auth.rate_limit]");
    expect(config).toContain("sign_in_sign_ups = 10");
    expect(config).toContain('max_frequency = "1m"');
    expect(config).toContain("otp_expiry = 3600");
    expect(authPage).not.toContain("auth.signUp");
    expect(authPage).not.toContain('value="signup"');
    expect(authPage).toContain("acesso é criado por convite");
    expect(createMember).toContain("inviteUserByEmail");
    expect(createMember).not.toContain("auth.admin.createUser");
    expect(createMember).toContain('rpc("prepare_auth_invite"');
    expect(createMember).toContain("agvlog_invite_nonce: inviteNonce");
    expect(createMember).toContain('rpc("cancel_auth_invite"');
    expect(createMember).not.toMatch(/\bpassword\s*[:,]/);
    expect(updateMember).toContain("Administrators cannot set another user's password");
    expect(teamManagement).not.toContain("setPassword");
    expect(setPasswordPage).toContain("supabase.auth.updateUser({ password })");
    expect(setPasswordPage).toContain("value.length >= 12");
  });

  it("enforces invite-only user creation at the database boundary", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260828185133_enforce_invite_only_auth_users.sql",
    );
    const hardening = read(
      "supabase",
      "migrations",
      "20260828185757_harden_auth_invite_authorizations.sql",
    );

    expect(migration).toContain("create table private.auth_invite_authorizations");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("before insert on auth.users");
    expect(migration).toContain("User creation requires an authorized invitation");
    expect(migration).toContain("- 'agvlog_invite_nonce'");
    expect(migration).toContain(
      "revoke execute on function private.enforce_invite_only_auth_user()",
    );
    expect(hardening).toContain("auth_invite_authorizations_tenant_id_idx");
    expect(hardening).toContain("auth_invite_authorizations_invited_by_idx");
    expect(hardening).toContain("auth_invite_authorizations_deny_client_access");
    expect(hardening).toContain("to anon, authenticated");
    expect(hardening).toContain("using (false)");
  });

  it("does not expose autonomous tenant provisioning through the Data API", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260830013726_restrict_tenant_creation_to_platform.sql",
    );

    expect(migration).toContain("public.create_tenant_with_owner(text)");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).not.toMatch(/grant\s+execute[\s\S]*create_tenant_with_owner/i);
    expect(migration).toContain("Tenant provisioning is restricted to the platform backend");
  });

  it("allows password login without authenticator enrollment for every role", () => {
    const config = read("supabase", "config.toml");
    const routeGuards = read("src", "app", "routeGuards.tsx");

    expect(config).toContain("[auth.mfa]");
    expect(config).toContain("[auth.mfa.totp]");
    expect(config).toContain("enroll_enabled = false");
    expect(config).toContain("verify_enabled = false");
    expect(config).toContain('additional_redirect_urls = ["https://agvlog.lovable.app/set-password"]');
    expect(routeGuards).not.toContain('PrivilegedMfaGate');
    expect(routeGuards).not.toContain('auth.mfa');
    expect(routeGuards).toContain("<RequireInternalRole>{children}</RequireInternalRole>");
    expect(routeGuards).toContain("if (!user) return <Navigate to=\"/auth\" replace />");
  });

  it("tracks service credentials explicitly and keeps Control Tower writes on caller JWT and tenant roles", () => {
    const functionsRoot = join(root, "supabase", "functions");
    const serviceRoleHandlers = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => ({
        name: entry.name,
        source: read("supabase", "functions", entry.name, "index.ts"),
      }))
      .filter(({ source }) => source.includes("SUPABASE_SERVICE_ROLE_KEY"));

    // Inventory is not an authorization audit. Remaining handlers need their
    // own role/tenant review; absence of MFA must not remove authorization.
    expect(serviceRoleHandlers.map(handler => handler.name).sort()).toEqual([
      "agvlog-aggregate-daily", "agvlog-compute-state", "agvlog-integration-upsert",
      "agvlog-pipeline-run", "agvlog-process-vehicle", "agvlog-run-queue",
      "clients-merge-contacts-addresses", "create-team-member", "cte-sefaz-callback",
      "cte-status-poll", "emit-nfse", "fiscal-certificate-manage", "frontend-error-report", "get-client-pod-signed-url",
      "hub-fiscal-credential-save", "hub-fiscal-proxy", "hub-fiscal-webhook-in",
      "list-tenant-members", "nfse-status-poll", "search-users-by-email", "secure-upload",
      "ssx-diagnostic", "ssx-insert-person", "ssx-insert-person-client", "ssx-login",
      "ssx-poll-positions", "ssx-sync-telemetry", "ssx-sync-units", "tax-registry-consult", "update-team-member",
      "update-trip-live-status",
    ].sort());
    for (const name of ["calculate-trip-route", "update-trip-live-status"]) {
      const source=read("supabase","functions",name,"index.ts");
      expect(source).toContain("canManageControlTower(anon,");
      expect(source).toMatch(/const supabase\s*=\s*anon;/);
    }
    expect(read("supabase","functions","calculate-trip-route","index.ts")).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(read("supabase","functions","update-trip-live-status","index.ts")).toContain("requireIntegrationCapability(capabilityClient,tenant_id,'ssx')");
    const guard=read("supabase","functions","_shared","control-tower-auth.ts");
    expect(guard).not.toMatch(/getAuthenticatorAssuranceLevel|aal2/);
    expect(guard).toContain("rpc('is_tenant_operator_or_admin'");
  });

  it("requires platform JWT validation for browser-invoked Edge Functions", () => {
    const config = read("supabase", "config.toml");
    const userFunctions = [
      "calculate-trip-route",
      "extract-ort",
      "hub-fiscal-proxy",
      "search-users-by-email",
      "ssx-insert-person",
      "ssx-insert-person-client",
      "update-trip-live-status",
      "agvlog-process-vehicle",
    ];

    for (const name of userFunctions) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = true`));
    }
  });

  it("declares JWT mode explicitly for every Edge Function", () => {
    const config = read("supabase", "config.toml");
    const functionsRoot = join(root, "supabase", "functions");
    const functionNames = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .filter((entry) => {
        try {
          readFileSync(join(functionsRoot, entry.name, "index.ts"), "utf8");
          return true;
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name);
    const configured = new Map(
      [...config.matchAll(/\[functions\.([^\]]+)\]\s+verify_jwt = (true|false)/g)]
        .map((match) => [match[1], match[2] === "true"]),
    );

    expect([...configured.keys()].sort()).toEqual([...functionNames].sort());
    const secretValidatedHandlers = new Set([
      "agvlog-aggregate-daily",
      "agvlog-compute-state",
      "agvlog-pipeline-run",
      "agvlog-run-queue",
      "cte-sefaz-callback",
      "cte-status-poll",
      "hub-fiscal-webhook-in",
      "nfse-status-poll",
      "ssx-login",
      "ssx-poll-positions",
      "ssx-sync-units",
    ]);
    expect(
      [...configured.entries()]
        .filter(([, verifyJwt]) => !verifyJwt)
        .map(([name]) => name)
        .sort(),
    ).toEqual([...secretValidatedHandlers].sort());
  });

  it("keeps every non-JWT Edge Function protected by an explicit alternate authenticator", () => {
    const cronOrHumanHandlers = [
      "agvlog-aggregate-daily",
      "agvlog-compute-state",
      "agvlog-pipeline-run",
      "agvlog-run-queue",
      "cte-status-poll",
      "nfse-status-poll",
    ];

    for (const name of cronOrHumanHandlers) {
      const source = read("supabase", "functions", name, "index.ts");
      expect(source, `${name} must validate the Vault-backed cron secret`).toContain(
        "isCronRequest",
      );
      expect(source, `${name} must retain authenticated human access`).toMatch(
        /auth\.(?:getUser|getClaims)\(/,
      );
      expect(source, `${name} must scope human access to an active tenant membership`).toMatch(
        /\.from\(["']tenant_memberships["']\)/,
      );
    }

    const cronAuthenticator = read(
      "supabase",
      "functions",
      "_shared",
      "cron-auth.ts",
    );
    expect(cronAuthenticator).toContain('req.headers.get("x-agvlog-cron-secret")');
    expect(cronAuthenticator).toContain('admin.rpc("verify_agvlog_cron_secret"');
    expect(cronAuthenticator).toContain("return !error && data === true");

    const sefazCallback = read(
      "supabase",
      "functions",
      "cte-sefaz-callback",
      "index.ts",
    );
    expect(sefazCallback).toContain("Deno.env.get('FISCAL_WEBHOOK_TOKEN')");
    expect(sefazCallback).toMatch(/if \(!expectedToken\)[\s\S]*?status: 503/);
    expect(sefazCallback).toMatch(/if \(provided !== expectedToken\)[\s\S]*?status: 401/);

    const hubCallback = read(
      "supabase",
      "functions",
      "hub-fiscal-webhook-in",
      "index.ts",
    );
    expect(hubCallback).toContain("Deno.env.get('HUB_FISCAL_WEBHOOK_SECRET')");
    expect(hubCallback).toMatch(/if \(!SHARED_SECRET\)[\s\S]*?status: 503/);
    expect(hubCallback).toMatch(/if \(provided !== SHARED_SECRET\)[\s\S]*?status: 403/);
  });

  it("does not fall back to public or legacy routing/fiscal endpoints", () => {
    const sources = [
      read("supabase", "functions", "_shared", "osrm.ts"),
      read("supabase", "functions", "hub-fiscal-proxy", "index.ts"),
      read("supabase", "functions", "cte-status-poll", "index.ts"),
      read("supabase", "functions", "nfse-status-poll", "index.ts"),
    ].join("\n");

    expect(sources).not.toContain("router.project-osrm.org");
    expect(sources).not.toContain("rvgcsmuyvesusbxsqevr.supabase.co");
    expect(sources).toContain("OSRM_BASE_URL is not configured");
    expect(sources).toContain("HUB_FISCAL_BASE_URL não configurado");
  });

  it("scopes the fiscal proxy to an explicit authorized tenant", () => {
    const proxy = read("supabase", "functions", "hub-fiscal-proxy", "index.ts");

    expect(proxy).not.toContain("select('tenant_id').eq('user_id', userId).limit(1)");
    expect(proxy).toContain(".in('role', ['owner', 'admin', 'operator'])");
    expect(proxy).toContain("error: { code: 'TENANT_REQUIRED'");
    expect(proxy).toContain(".eq('tenant_id', tenantId).eq('emitter_id', emId)");
  });

  it("does not disclose identities attached only to another tenant", () => {
    const searchUsers = read(
      "supabase",
      "functions",
      "search-users-by-email",
      "index.ts",
    );

    expect(searchUsers).toContain('.from("tenant_memberships")');
    expect(searchUsers).toContain('.from("client_portal_access")');
    expect(searchUsers).toContain(
      "relatedTenantIds.size === 0 || relatedTenantIds.has(tenant_id)",
    );
  });

  it("keeps SSX person writes typed and restricted to operational roles", () => {
    const driverSync = read("supabase", "functions", "ssx-insert-person", "index.ts");
    const clientSync = read("supabase", "functions", "ssx-insert-person-client", "index.ts");

    expect(driverSync).not.toMatch(/\bany\b/);
    expect(clientSync).not.toMatch(/\bany\b/);
    expect(driverSync).toContain('["owner", "admin"]');
    expect(clientSync).toContain('["owner", "admin", "operator"]');
  });

  it("does not embed operational identities or vehicle guesses in the MDF-e form", () => {
    const mdfePage = read("src", "pages", "MdfeProvisional.tsx");

    expect(mdfePage).toContain("deriveMdfeDialogDefaults");
    expect(mdfePage).not.toMatch(/useState\(["']\d{11,14}["']\)/);
    expect(mdfePage).not.toMatch(
      /plate\?\.toUpperCase\(\)\s*===\s*["'][A-Z]{3}[0-9A-Z][0-9]{2}[0-9A-Z]["']/,
    );
  });

  it("treats missing telemetry rows as an expected empty state", () => {
    for (const name of [
      "agvlog-compute-state",
      "agvlog-process-vehicle",
      "agvlog-run-queue",
    ]) {
      const source = read("supabase", "functions", name, "index.ts");
      expect(source, `${name} must not emit 406 when telemetry is absent`).not.toMatch(
        /\.from\(["']positions_(?:last|raw)["']\)[\s\S]{0,350}?\.single\(\)/,
      );
    }

    const queue = read("supabase", "functions", "agvlog-run-queue", "index.ts");
    for (const table of ["geofence_states", "telemetry_observations"]) {
      expect(queue, `${table} is optional before its first upsert`).not.toMatch(
        new RegExp(`\\.from\\(["']${table}["']\\)[\\s\\S]{0,300}?\\.single\\(\\)`),
      );
    }
  });

  it("changes the default fiscal emitter atomically and only when active", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260828181017_set_default_emitter_atomic.sql",
    );
    const emitterHook = read("src", "hooks", "useEmitters.tsx");
    const billingHook = read("src", "hooks", "useBilling.tsx");

    expect(migration).toContain("CHECK (NOT is_default OR active)");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("public.is_tenant_admin(_tenant_id)");
    expect(migration).toMatch(/ORDER BY emitter\.id\r?\n  FOR UPDATE/);
    expect(migration).toContain("AND emitter.active");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(emitterHook).toContain("supabase.rpc('set_default_tenant_emitter'");
    expect(emitterHook).not.toContain("update({ is_default: false })");
    expect(billingHook).not.toContain("emitter?.id || input.emitter_id");
  });

  it("keeps high-volume registries paginated at the database boundary", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260829142719_restore_production_frontend_pagination_contracts.sql",
    );
    const clientsHook = read("src", "hooks", "useClients.tsx");
    const fiscalHook = read("src", "hooks", "useFiscalDocuments.tsx");
    const loadsHook = read("src", "hooks", "useLoads.tsx");
    const clientsPage = read("src", "pages", "Clients.tsx");
    const fiscalPage = read("src", "pages", "FiscalDocuments.tsx");
    const loadsPage = read("src", "pages", "Loads.tsx");

    expect(migration).toContain("security invoker");
    expect(migration).toContain("public.get_fiscal_document_summary_v1");
    expect(migration).toContain("public.list_loads_page_v1");
    expect(migration).toMatch(/revoke execute[\s\S]*?from public, anon/);
    expect(clientsHook).toContain(".range(from, from + pageSize - 1)");
    expect(fiscalHook).toContain(".range(from, from + pageSize - 1)");
    expect(fiscalHook).toContain("rpc('get_fiscal_document_summary_v1'");
    expect(loadsHook).toContain("rpc('list_loads_page_v1'");
    for (const source of [clientsPage, fiscalPage, loadsPage]) {
      expect(source).toContain("useDebouncedValue");
      expect(source).toContain("setSearchParams");
    }
  });

  it("keeps baseline web security headers enabled", () => {
    const config = read("vercel.json");
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]) {
      expect(config).toContain(header);
    }
  });
});
