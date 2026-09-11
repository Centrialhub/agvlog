// @vitest-environment node
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

describe('delivery receipt email Edge Functions',()=>{
  it('keeps PDFs private and sends only after an authenticated database claim',()=>{
    const source=readFileSync(join(process.cwd(),'supabase','functions','send-delivery-receipts','index.ts'),'utf8');
    expect(source).toContain("caller.rpc('claim_delivery_receipt_email_v1'");
    expect(source).toContain("admin.storage.from('receipts').download(item.path)");
    expect(source).toContain("import {PDFDocument,StandardFonts,rgb} from 'pdf-lib'");
    expect(source).toContain('const bytes=await addCover(sourceBytes,item.cover)');
    expect(source).toContain("'Idempotency-Key':`delivery-receipts-${batchId}`");
    expect(source).toContain('MAX_ATTACHMENTS=5');
    expect(source).toContain('MAX_RECIPIENTS=10');
    expect(source).toContain('totalProviderBytes+=content.length');
    expect(source).toContain('MAX_TOTAL_PROVIDER_BYTES=25*1024*1024');
    expect(source).toContain('PROVIDER_TIMEOUT_MS=30_000');
    expect(source).toContain("sent.status===429");
    expect(source).toContain('_lease_token:leaseToken');
    expect(source).toContain("caller.rpc('complete_delivery_receipt_email_v1'");
  });

  it('verifies the provider signature and records delivery, bounce or failure through a service-only RPC',()=>{
    const source=readFileSync(join(process.cwd(),'supabase','functions','delivery-receipt-email-webhook','index.ts'),'utf8');
    expect(source).toContain("request.headers.get('svix-signature')");
    expect(source).toContain("request.headers.get('svix-id')");
    expect(source).toContain("crypto.subtle.sign('HMAC'");
    expect(source).toContain("event.type==='email.delivered'");
    expect(source).toContain("admin.rpc('apply_delivery_receipt_email_webhook_v1'");
    expect(source).toContain('_svix_id:svixId');
    expect(source).toContain("return json(503,{error:'delivery_email_batch_not_ready'})");
  });
});
