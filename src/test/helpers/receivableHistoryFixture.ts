import type {ReceivableHistory,ReceivableHistorySnapshot} from '@/lib/financial/receivableHistoryContract';
export const historyIds={tenant:'00000000-0000-4000-8000-000000000001',title:'00000000-0000-4000-8000-000000000002',actor:'00000000-0000-4000-8000-000000000003',payer:'00000000-0000-4000-8000-000000000004'};
export function historySnapshot():ReceivableHistorySnapshot{return {
 description:'Frete preservado',invoice_number:'100',status:'pending',due_date:'2026-09-15',amount_cents:'100000',received_cents:'0',client_id:historyIds.payer,
 payer:{id:historyIds.payer,tenant_id:historyIds.tenant,company_name:'Fornecedor da entrega'},
 source:{order_id:null,fiscal_document_id:null,load_id:null,client_invoice_id:null,closing_report_id:null},issues:[],
};}
export function receivableHistoryFixture():ReceivableHistory{return {
 version:1,tenant_id:historyIds.tenant,receivable_id:null,basis:'captured_versions',captured_at:'2026-09-10T20:00:00+00:00',revision:'a'.repeat(32),
 coverage:{starts_at:'2026-09-10T18:00:00+00:00',baseline_kind:'existing_tenant',capture_basis:'transaction_capture_not_commit'},
 page:1,page_size:50,total:1,rows:[{event_order:'1',receivable_id:historyIds.title,operation:'BASELINE',captured_at:'2026-09-10T18:00:00+00:00',transaction_id:'20',actor_id:null,actor_name:null,actor_kind:'system',before:null,after:historySnapshot(),changed_fields:[]}],
 limitations:['capture_time_is_not_commit_time','not_a_historical_balance'],
};}
