import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it,vi} from 'vitest';
import {supplierPortalCapabilitiesSchema,supplierPortalConfigurationSchema} from '@/lib/deliveryReceipts/deliveryReceiptChannels';

vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));

const migration=readFileSync(join(process.cwd(),'supabase','migrations','20260910181420_add_delivery_receipt_supplier_channels.sql'),'utf8');
const worker=readFileSync(join(process.cwd(),'supabase','functions','process-delivery-receipt-portals','index.ts'),'utf8');
const adapter=readFileSync(join(process.cwd(),'supabase','functions','process-delivery-receipt-portals','adapter.ts'),'utf8');

describe('supplier delivery receipt channels',()=>{
  it('keeps the generic portal adapter disabled and requires trusted verification before automatic enqueue',()=>{
    expect(migration).toContain("'supplier_portal_generic_v1','portal','Portal genérico (não implementado)',false,false");
    expect(migration).toContain("lifecycle_status='verified' and channel.auto_enqueue");
    expect(migration).toContain('adapter.is_implemented and adapter.is_enabled');
    expect(migration).toContain("raise exception 'delivery_receipt_channel_adapter_unavailable'");
    expect(migration).toContain("grant execute on function public.verify_delivery_receipt_supplier_channel_v1");
    expect(migration).toContain('to service_role;');
  });

  it('creates a durable idempotent lease queue and immutable supplier/document snapshots',()=>{
    expect(migration).toContain('create table public.delivery_receipt_channel_jobs');
    expect(migration).toContain('unique (channel_id,receipt_id,evidence_fingerprint)');
    expect(migration).toContain('unique (tenant_id,idempotency_key)');
    expect(migration).toContain('for update of job skip locked');
    expect(migration).toContain("'delivery-receipt-portal:'||v_fingerprint");
    expect(migration).toContain("'kind',reference.document_kind");
    expect(migration).toContain("('nfe','nfse','cte','other_fiscal','operational_reference')");
    expect(migration).not.toMatch(/document_kind\s*=\s*'cte'/);
  });

  it('versions and snapshots supplier email templates without changing individual PDF batches',()=>{
    expect(migration).toContain('add column template_version integer not null default 1');
    expect(migration).toContain('create trigger snapshot_delivery_receipt_email_template');
    expect(migration).toContain('new.template_customized :=');
    expect(migration).toContain("'body_template',v_template.body_template");
    expect(migration).toContain('create or replace function public.plan_delivery_receipt_email_batches_v1');
    expect(migration).toContain("join storage.objects object on object.bucket_id='receipts'");
    expect(migration).toContain('v_current_projected+v_provider_bytes>26214400');
    expect(migration).toContain('((v_item.source_bytes+v_reserve+2)/3)*4');
    expect(migration).toContain('create trigger validate_delivery_receipt_email_batch_sizes');
  });

  it('has a fail-closed worker with no supplier network call or success completion path',()=>{
    expect(worker).toContain("isCronRequest(request,url,serviceKey)");
    expect(worker).toContain("DELIVERY_RECEIPT_PORTAL_WORKER_ENABLED')!=='true'");
    expect(worker).toContain("DELIVERY_RECEIPT_PORTAL_ADAPTER_ALLOWLIST");
    expect(worker).toContain("admin.rpc('fail_delivery_receipt_channel_job_v1'");
    expect(worker).not.toContain("complete_delivery_receipt_channel_job_v1");
    expect(worker).not.toMatch(/\bfetch\s*\(/);
    expect(adapter).toContain("status: 'unavailable'");
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
  });

  it('accepts only non-secret HTTPS configuration and explicit capabilities',()=>{
    expect(supplierPortalConfigurationSchema.parse({portal_origin:'https://portal.fornecedor.test',account_reference:null,
      credential_reference:'SUPPLIER_PORTAL_FORNECEDOR',upload_path_hint:null}).portal_origin).toBe('https://portal.fornecedor.test');
    expect(()=>supplierPortalConfigurationSchema.parse({portal_origin:'http://localhost:8080',account_reference:null,
      credential_reference:'token-real',upload_path_hint:null})).toThrow();
    expect(supplierPortalCapabilitiesSchema.parse({receipt_upload:true,document_metadata:true,supports_idempotency:true,
      multi_receipt_batch:false,max_files_per_request:1,accepted_document_kinds:['nfe','nfse','cte']}).supports_idempotency).toBe(true);
  });

  it('enables RLS and least-privilege grants on every exposed channel table',()=>{
    for(const table of ['delivery_receipt_channel_adapters','delivery_receipt_supplier_channels','delivery_receipt_channel_jobs','delivery_receipt_channel_job_events']){
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('revoke all on table public.delivery_receipt_channel_adapters');
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+to authenticated/i);
  });
});
