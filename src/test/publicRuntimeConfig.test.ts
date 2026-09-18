import { describe, expect, it } from "vitest";
import { publicRuntimeConfigIssues } from "@/config/publicRuntimeConfig";

describe("public runtime configuration", () => {
  it("accepts hosted Supabase and local development origins", () => {
    expect(publicRuntimeConfigIssues({
      VITE_SUPABASE_URL: "https://project-ref.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    })).toEqual([]);
    expect(publicRuntimeConfigIssues({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
    })).toEqual([]);
  });

  it("reports missing values without echoing their contents", () => {
    expect(publicRuntimeConfigIssues({})).toEqual([
      "missing_supabase_url",
      "missing_supabase_publishable_key",
    ]);
  });

  it("rejects malformed, credentialed and insecure remote URLs", () => {
    for (const value of ["not-a-url", "http://project.supabase.co", "https://user:pass@project.supabase.co"]) {
      expect(publicRuntimeConfigIssues({
        VITE_SUPABASE_URL: value,
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      })).toEqual(["invalid_supabase_url"]);
    }
  });
});
