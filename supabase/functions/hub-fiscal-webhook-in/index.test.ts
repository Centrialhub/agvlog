import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

type Receiver = (request: Request) => Promise<Response>;
const secret = 'synthetic-webhook-test-secret';
const origin = 'https://local-fixture.invalid';

Deno.test('signed diagnostics stay separate from fiscal callbacks', async (t) => {
  const env = {
    SUPABASE_URL: origin,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    HUB_FISCAL_WEBHOOK_SECRET: secret,
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  const originalServe = Deno.serve;
  const originalFetch = globalThis.fetch;
  const databaseCalls: string[] = [];
  let receiver: Receiver | undefined;
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    Deno.serve = ((handler: Receiver) => {
      receiver = handler;
    }) as unknown as typeof Deno.serve;
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, origin);
      databaseCalls.push(url.pathname);
      assert.equal(url.pathname, '/rest/v1/rpc/claim_fiscal_webhook_delivery_v1');
      return Response.json([{
        inbox_id: '41fa4a76-ffcf-4f82-b9c4-c5b19435981b',
        claimed: false,
        inbox_status: 'processed',
        retry_after_seconds: null,
      }]);
    };
    await import('./index.ts');
    assert.ok(receiver);
    const handle = receiver;
    const diagnostic = { event: 'webhook.test', test: true, createdAt: '2026-11-10T12:00:00Z' };

    function send(payload: unknown, options: { key?: string; timestamp?: string; event?: string } = {}) {
      const body = JSON.stringify(payload);
      const timestamp = options.timestamp ?? new Date().toISOString();
      const signature = createHmac('sha256', options.key ?? secret).update(timestamp + '.' + body).digest('hex');
      return handle(new Request(origin, {
        method: 'POST',
        headers: {
          'x-hubfiscal-timestamp': timestamp,
          'x-hubfiscal-signature': 'sha256=' + signature,
          'x-hubfiscal-event': options.event ?? 'webhook.test',
          'x-hubfiscal-delivery': 'synthetic-delivery',
        },
        body,
      }));
    }

    await t.step('accepts the Hub diagnostic without accessing fiscal storage', async () => {
      const response = await send(diagnostic);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      assert.deepEqual(databaseCalls, []);
    });
    await t.step('rejects invalid signatures and expired timestamps', async () => {
      for (const options of [{ key: 'incorrect' }, { timestamp: '2020-01-01T00:00:00Z' }]) {
        const response = await send(diagnostic, options);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error, 'invalid_webhook_signature');
      }
      assert.deepEqual(databaseCalls, []);
    });
    await t.step('requires the exact diagnostic event and boolean marker in the signed body', async () => {
      for (const payload of [
        { event: 'fiscal_document.updated', test: true },
        { event: 'webhook.test', test: 'true' },
        { event: 'webhook.test', test: true, document: {} },
      ]) {
        const response = await send(payload);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'missing_identifier');
      }
      assert.deepEqual(databaseCalls, []);
    });
    await t.step('preserves the fiscal inbox route for callbacks with a document', async () => {
      for (const payload of [
        { event: 'fiscal_document.updated', document: { id: 'synthetic-document', status: 'authorized' } },
        { ...diagnostic, document: { id: 'synthetic-document', status: 'authorized' } },
        { ...diagnostic, idIntegracao: 'synthetic-integration', status: 'authorized' },
      ]) {
        const response = await send(payload);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).duplicate, true);
      }
      assert.deepEqual(databaseCalls, Array(3).fill('/rest/v1/rpc/claim_fiscal_webhook_delivery_v1'));
    });
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
