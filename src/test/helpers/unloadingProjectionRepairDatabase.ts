import {randomUUID} from 'node:crypto';
import {financeAs,financeIds as i} from './financeLedgerDatabase';
import {readFileSync} from 'node:fs';
import {createUnloadingBankPackageDatabase} from './unloadingBankPackageDatabase';
export async function createUnloadingProjectionRepairDatabase(){
 const db=await createUnloadingBankPackageDatabase(false);
 for(const [file,table] of [['20260824224152_baseline','driver_settlement_items'],['20260910010034_finance_fiscal_receivable_projection','finance_fiscal_receivable_origins']]){
  const source=readFileSync('supabase/migrations/'+file+'.sql','utf8');const ddl=source.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!ddl)throw new Error(table);
  // Real table columns/constraints; remote fiscal parents are outside this fixture.
  await db.exec(ddl.replace(/ references public\.\w+\([^)]*\)/gi,''));
 }
 return db;
}

export async function seedUnloadingRepairSource(db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>,withCost=false){
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência integrada de descarga e banco'});
 const rpc=async<T>(name:string,args:unknown[]) => (await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,index)=>'$'+(index+1)).join(',')}) v`,args)).rows[0].v;
 const supplier=randomUUID(),trip=randomUUID(),stop=randomUUID(),doc=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Fornecedor preservado',true)",[supplier,i.tenant]);
 await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'completed')",[trip,i.tenant]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,status,client_id,destination) values($1,$2,$3,1,'completed',$4,'Sede do cliente')",[stop,i.tenant,trip,supplier]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status) values($1,$2,$3,$3,'inbound','ready')",[doc,i.tenant,supplier]);
 await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',[i.tenant,stop,doc]);
 const context=await rpc<{revision:string;issue:string|null}>('get_finance_delivery_context',[i.tenant,stop]);if(context.issue)throw new Error(context.issue);
 const receipt=i.tenant+'/receipts/descarga.pdf';await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[receipt]);
 if(withCost){
  const batchSource=readFileSync('supabase/migrations/20260909213959_finance_expense_batches.sql','utf8');
  if(!(await db.query<{present:boolean}>("select to_regprocedure('finance_private.record_expense_batch(jsonb)') is not null present")).rows[0].present)await db.exec(batchSource.slice(batchSource.indexOf('create function finance_private.record_expense_batch')));
  const expense=randomUUID(),provider=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Prestador diferente do devedor',true)",[provider,i.tenant]);await rpc('record_finance_expense_batch',[{...base(),context:'trip',trip_id:trip,description:'Descarga com custo original',items:[{id:expense,category:'unloading',description:'Serviço pago ao prestador',amount_cents:15000,occurred_on:'2026-08-02',due_date:'2026-08-20',supplier_id:provider,supplier_name:'Prestador diferente do devedor',payee_type:'supplier',receipt_path:receipt,allocations:[],stop_id:stop,delivery_revision:context.revision}]}]);
  const c=(await db.query<{charge_id:string;receivable_id:string}>('select id charge_id,receivable_id from finance_unloading_charges where tenant_id=$1 and delivery_stop_id=$2',[i.tenant,stop])).rows[0];return{...c,supplier};
 }
 const result=await rpc<{receivable_id:string;charge_id:string}>('record_finance_unloading',[{...base(),stop_id:stop,expected_revision:context.revision,amount_cents:15000,occurred_on:'2026-08-02',due_date:'2026-08-20',receipt_path:receipt}]);
 return{...result,supplier};
}
