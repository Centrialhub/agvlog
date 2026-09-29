import { request } from "@playwright/test";
import { writeFile, unlink } from "node:fs/promises";
import { obtainCandidateBypassState } from "../../scripts/release-candidate-origin.mjs";
import { assertHostedStagingSupabaseUrl } from "../../scripts/release-backend-identity.mjs";

export default async function vercelProtectionSetup() {
  const candidate = process.env.E2E_BASE_URL;
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const stateFile = process.env.AGVLOG_VERCEL_BYPASS_STATE_FILE;
  const expectedSupabaseUrl = process.env.VITE_SUPABASE_URL;
  const expectedRelease = process.env.DEPLOY_EXPECTED_RELEASE;
  if (!candidate || !secret || !stateFile || !expectedSupabaseUrl || !expectedRelease) {
    throw new Error("Hosted Preview bypass configuration is incomplete.");
  }
  assertHostedStagingSupabaseUrl(expectedSupabaseUrl);

  const state = await obtainCandidateBypassState(candidate, secret, request, {
    expectedSupabaseUrl, expectedRelease,
  });
  try {
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  } catch (error) {
    // `wx` refuses an existing path. Never remove someone else's file when
    // that collision is the reason the write failed.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      await unlink(stateFile).catch(() => undefined);
    }
    throw error;
  }

  return async () => {
    await unlink(stateFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
}
