// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('delivery receipt OCR worker contract',()=>{
  it('uses service-only queue RPCs and performs no PII download or network OCR when unavailable',()=>{
    const worker=readFileSync('supabase/functions/process-delivery-receipt-ocr/index.ts','utf8');
    const adapter=readFileSync('supabase/functions/process-delivery-receipt-ocr/adapter.ts','utf8');
    expect(worker).toContain("admin.rpc('claim_delivery_receipt_ocr_v1'");
    expect(worker).toContain("_status:'unavailable'");
    expect(worker).toContain("admin.rpc('complete_delivery_receipt_ocr_v1'");
    expect(worker).not.toMatch(/storage\.from|fetch\(/);
    expect(adapter).toContain("errorCode:'ocr_not_configured'");
    expect(adapter).toContain("errorCode:'ocr_adapter_unsupported'");
  });
});
