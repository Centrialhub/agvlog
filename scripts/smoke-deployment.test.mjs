import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

let server;
let origin;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/release.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ release: "a".repeat(40), buildHash: "b".repeat(16) }));
      return;
    }
    if (request.url === "/assets/app.js") {
      response.setHeader("content-type", "application/javascript");
      response.end("console.log('candidate')");
      return;
    }
    if (request.url === "/auth/v1/signup" && request.method === "POST") {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ error_code: "signup_disabled", message: "Signups not allowed" }));
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html",
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=63072000",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "microphone=()",
      });
      response.end('<!doctype html><script type="module" src="/assets/app.js"></script>');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function runSmoke(expectedRelease) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/smoke-deployment.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEPLOY_SMOKE_URL: origin,
        DEPLOY_SMOKE_ALLOW_HTTP: "true",
        DEPLOY_EXPECTED_RELEASE: expectedRelease,
        DEPLOY_SUPABASE_URL: origin,
        DEPLOY_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("accepts a healthy immutable candidate with signup disabled", async () => {
  const result = await runSmoke("a".repeat(40));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment smoke passed/);
});

test("rejects a deployed artifact from another commit", async () => {
  const result = await runSmoke("c".repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate release mismatch/);
});
