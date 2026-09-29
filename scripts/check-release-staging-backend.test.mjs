import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertHostedStagingSupabaseUrl, assertReleaseSupabaseOrigin } from "./release-backend-identity.mjs";

const script = fileURLToPath(new URL("./check-release-staging-backend.mjs", import.meta.url));
const production = "https://qcvnsdrbcchaxvawcngk.supabase.co";
const staging = "https://staging-project.supabase.co";

function preflight(value) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, STAGING_SUPABASE_URL: value },
  });
}

test("trusted preflight accepts staging and refuses the production backend", () => {
  assert.equal(preflight(staging).status, 0);
  for (const url of [production, `${production}/`, `${production}.`, `${production}:444`]) {
    const result = preflight(url);
    assert.notEqual(result.status, 0, `accepted production URL ${url}`);
    assert.match(result.stderr, /production Supabase project|HTTPS Supabase origin/);
  }
});

test("hosted guard rejects missing or malformed URLs, while generic release identity accepts production smoke", () => {
  for (const url of [undefined, "not-a-url", "http://staging-project.supabase.co", `${staging}/auth`, `${staging}/?x=1`]) {
    assert.throws(() => assertHostedStagingSupabaseUrl(url), /staging Supabase URL|Supabase URL is invalid|HTTPS Supabase origin/);
  }
  assert.equal(assertReleaseSupabaseOrigin({ supabaseOrigin: production }, production), production);
});
