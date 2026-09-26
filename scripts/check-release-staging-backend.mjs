import { assertHostedStagingSupabaseUrl } from "./release-backend-identity.mjs";

assertHostedStagingSupabaseUrl(process.env.STAGING_SUPABASE_URL);
console.log("Hosted E2E staging backend verified.");
