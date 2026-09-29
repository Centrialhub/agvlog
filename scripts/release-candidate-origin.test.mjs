import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertImmutableCandidateOrigin,
  candidateBypassHeaders,
  obtainCandidateBypassState,
} from "./release-candidate-origin.mjs";

const candidate = "https://agvlogistica-btoo2apkz-centrialhubs-projects.vercel.app";
const secret = "test-only-bypass-secret";
const expectedRelease = "a".repeat(40);
const expectedSupabaseUrl = "https://staging-project.supabase.co";
const identity = { expectedRelease, expectedSupabaseUrl };

test("accepts only the approved immutable deployment origin before attaching a bypass", () => {
  assert.equal(assertImmutableCandidateOrigin(candidate), candidate);
  assert.deepEqual(candidateBypassHeaders(candidate, secret), { "x-vercel-protection-bypass": secret });
  for (const url of [
    "https://agvlogistica.vercel.app",
    "https://agvlogistica-git-main-centrialhubs-projects.vercel.app",
    `${candidate}.attacker.example`,
    "https://attacker.example",
    `${candidate}/auth`,
  ]) {
    assert.throws(() => candidateBypassHeaders(url, secret), /immutable deployment URL/);
  }
  assert.throws(() => candidateBypassHeaders(candidate, ""), /BYPASS_SECRET is required/);
});

test("authenticates one Preview request without redirects and limits browser cookies to its host", async () => {
  const seen = [];
  let disposed = false;
  const requestFactory = {
    async newContext() {
      return {
        async get(url, options) {
          seen.push({ url, options });
          return {
            ok: () => true, status: () => 200,
            json: async () => ({ release: expectedRelease, supabaseOrigin: expectedSupabaseUrl }),
          };
        },
        async storageState() {
          return {
            cookies: [
              { name: "__vercel_protection_bypass", value: "cookie-value", domain: ".vercel.app", path: "/", secure: true },
              { name: "unrelated", value: "other", domain: "other.example", path: "/" },
            ],
            origins: [{ origin: "https://other.example", localStorage: [] }],
          };
        },
        async dispose() { disposed = true; },
      };
    },
  };
  const state = await obtainCandidateBypassState(candidate, secret, requestFactory, identity);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${candidate}/release.json`);
  assert.equal(seen[0].options.maxRedirects, 0);
  assert.deepEqual(seen[0].options.headers, {
    "x-vercel-protection-bypass": secret,
    "x-vercel-set-bypass-cookie": "true",
  });
  assert.equal(state.cookies.length, 1);
  assert.equal(state.cookies[0].domain, new URL(candidate).hostname);
  assert.deepEqual(state.origins, []);
  assert.equal(disposed, true);
});

test("fails closed on SSO redirect without following it", async () => {
  let disposed = false;
  const requestFactory = {
    async newContext() {
      return {
        async get(_url, options) {
          assert.equal(options.maxRedirects, 0);
          return { ok: () => false, status: () => 302 };
        },
        async dispose() { disposed = true; },
      };
    },
  };
  await assert.rejects(obtainCandidateBypassState(candidate, secret, requestFactory, identity), /HTTP 302/);
  assert.equal(disposed, true);
});

test("rejects a protected response that did not establish a browser cookie", async () => {
  const requestFactory = {
    async newContext() {
      return {
        async get() {
          return {
            ok: () => true, status: () => 200,
            json: async () => ({ release: expectedRelease, supabaseOrigin: expectedSupabaseUrl }),
          };
        },
        async storageState() { return { cookies: [], origins: [] }; },
        async dispose() {},
      };
    },
  };
  await assert.rejects(obtainCandidateBypassState(candidate, secret, requestFactory, identity), /did not return a browser bypass cookie/);
});

test("hosted E2E refuses a Preview wired to another backend before saving browser state", async () => {
  let storageRead = false;
  const requestFactory = {
    async newContext() {
      return {
        async get() {
          return {
            ok: () => true, status: () => 200,
            json: async () => ({ release: expectedRelease, supabaseOrigin: "https://production-project.supabase.co" }),
          };
        },
        async storageState() { storageRead = true; return { cookies: [], origins: [] }; },
        async dispose() {},
      };
    },
  };
  await assert.rejects(obtainCandidateBypassState(candidate, secret, requestFactory, identity), /Supabase origin is absent or differs/);
  assert.equal(storageRead, false);
});

test("hosted E2E refuses the production backend before opening a request context or touching Auth", async () => {
  let contextOpened = false;
  const requestFactory = {
    async newContext() {
      contextOpened = true;
      throw new Error("must not reach Preview or Auth");
    },
  };
  await assert.rejects(obtainCandidateBypassState(candidate, secret, requestFactory, {
    expectedRelease,
    expectedSupabaseUrl: "https://qcvnsdrbcchaxvawcngk.supabase.co/",
  }), /production Supabase project/);
  assert.equal(contextOpened, false);
});
