// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as ids,seedCustomerCreditRefundSource} from './helpers/receivableBalanceAdjustmentReviewDatabase';

const adjustmentSql=()=>readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8');
const agreementSql=()=>readFileSync('supabase/migrations/20260914214752_finance_receivable_renegotiation.sql','utf8');

it('versions the remaining balance and integrates cash, credit, adjustments and reversals without duplicate receivables',async()=>{
  const db=await createReceivableBalanceAdjustmentReviewDatabase();
  try{
    const source=await seedCustomerCreditRefundSource(db);await db.exec('commit');await db.exec(adjustmentSql());await db.exec(agreementSql());
    const boundaries=(await db.query<{schema:string;name:string;definer:boolean;authenticated:boolean;anon:boolean;service:boolean}>(`
      select n.nspname schema,p.proname name,p.prosecdef definer,
       has_function_privilege('authenticated',p.oid,'execute') authenticated,
       has_function_privilege('anon',p.oid,'execute') anon,
       has_function_privilege('service_role',p.oid,'execute') service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='public' and p.proname in(
       'get_finance_receivable_agreement_context','record_finance_receivable_agreement',
       'get_finance_receivable_installment_position','get_finance_receivable_agreement_history',
       'get_finance_receivable_payment_installments','get_finance_closing_receivable_agreement'))
      or (n.nspname='finance_private' and p.proname in(
       'dispatch_receivable_agreement_context','dispatch_receivable_agreement_record',
       'dispatch_receivable_installment_position','dispatch_receivable_agreement_history',
       'dispatch_receivable_payment_installments','dispatch_closing_receivable_agreement',
       'receivable_agreement_context','record_receivable_agreement','receivable_installment_position',
       'receivable_agreement_history','receivable_payment_installment_history',
       'closing_receivable_agreement_position'))
    `)).rows;
    expect(boundaries).toHaveLength(18);
    for(const boundary of boundaries){
      expect(boundary.anon).toBe(false);expect(boundary.service).toBe(false);
      if(boundary.schema==='public')expect(boundary).toMatchObject({definer:false,authenticated:true});
      else if(boundary.name.startsWith('dispatch_'))expect(boundary).toMatchObject({definer:true,authenticated:true});
      else expect(boundary).toMatchObject({definer:true,authenticated:false});
    }
    await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
    await db.exec('savepoint cross_tenant');await expect(db.query('select finance_private.receivable_installment_position($1,$2)',[ids.otherTenant,source.target])).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint cross_tenant');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.driverUser]);await db.exec('savepoint driver_read');await expect(db.query('select finance_private.receivable_installment_position($1,$2)',[ids.tenant,source.target])).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint driver_read');
    await db.exec('savepoint driver_write');await expect(db.query('select finance_private.record_receivable_agreement($1)',[{version:1,tenant_id:ids.tenant,request_id:randomUUID(),receivable_id:source.target,action:'create',expected_revision:'a'.repeat(32),reason:'Motorista não pode renegociar',installments:[{id:randomUUID(),amount_cents:'100',due_on:'2026-10-10'}]}])).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint driver_write');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.operator]);
    const beforeCount=(await db.query<{n:number}>('select count(*)::int n from receivables')).rows[0].n;
    const snapshot=async()=>(await db.query<{v:{revision:string;open_cents:number}}>('select public._receivable_financial_snapshot($1,$2) v',[ids.tenant,source.target])).rows[0].v;
    const day=source.day;
    const pay=async(amount:number,extra:Record<string,unknown>={})=>{const s=await snapshot();return(await db.query<{v:{payment_id:string;revision:string}}>('select public.apply_receivable_financial_command($1) v',[{version:1,tenant_id:ids.tenant,actor_id:ids.operator,request_id:randomUUID(),receivable_id:source.target,expected_revision:s.revision,action:'receive',amount_cents:amount,effective_date:day,bank_account_id:ids.account,method:'pix',reason:'Recebimento distribuído no acordo',...extra}])).rows[0].v;};
    expect((await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v).toMatchObject({status:'none',requires_reallocation:false});
    await pay(10000);
    const installmentA=randomUUID(),installmentB=randomUUID(),proposal={action:'create',installments:[{id:installmentA,amount_cents:'20000',due_on:'2026-10-10'},{id:installmentB,amount_cents:'20000',due_on:'2026-11-10'}]};
    const preview=(await db.query<{v:{revision:string;eligible:boolean}}>('select finance_private.receivable_agreement_context($1,$2,$3) v',[ids.tenant,source.target,proposal])).rows[0].v;expect(preview.eligible).toBe(true);
    const agreementPayload={version:1,tenant_id:ids.tenant,request_id:randomUUID(),receivable_id:source.target,action:'create',expected_revision:preview.revision,reason:'Renegociação aprovada pelo responsável',installments:proposal.installments};
    const agreement=(await db.query<{v:{agreement_id:string}}>('select finance_private.record_receivable_agreement($1) v',[agreementPayload])).rows[0].v;
    expect((await db.query<{v:unknown}>('select finance_private.record_receivable_agreement($1) v',[agreementPayload])).rows[0].v).toEqual(agreement);
    await db.exec('savepoint request_conflict');await expect(db.query('select finance_private.record_receivable_agreement($1)',[{...agreementPayload,reason:'Mesmo request com payload diferente'}])).rejects.toThrow('finance_agreement_request_conflict');await db.exec('rollback to savepoint request_conflict');
    let position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;
    expect(position).toMatchObject({status:'active',open_cents:'40000',scheduled_open_cents:'40000',unallocated_open_cents:'0',requires_reallocation:false});
    const portfolio=(await db.query<{v:{open_cents:string;overdue_cents:string}}>('select finance_private.receivable_portfolio_summary($1,null,null,null) v',[ids.tenant])).rows[0].v;expect(portfolio.open_cents).toBe('40000');expect(portfolio.overdue_cents).toBe('0');
    const forecast=(await db.query<{v:{origins:Array<{economic_key:string}>}}>('select finance_private.cash_forecast_collect($1,$2,$3) v',[ids.tenant,'2026-09-01','2027-02-01'])).rows[0].v;expect(forecast.origins.some(row=>row.economic_key==='receivable:'+source.target+':installment:'+installmentA)).toBe(true);
    const paid=await pay(15000,{installment_allocations:[{installment_id:installmentA,amount_cents:'15000'}],expected_agreement_revision:position.revision});
    let paymentHistory=(await db.query<{v:{total:number;rows:Array<{action:string;installment_id:string}>}}>('select finance_private.receivable_payment_installment_history($1,$2,$3,0,30,null) v',[ids.tenant,source.target,paid.payment_id])).rows[0].v;expect(paymentHistory).toMatchObject({total:1});expect(paymentHistory.rows[0]).toMatchObject({action:'allocate',installment_id:installmentA});
    position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;expect(position.installments[0]).toMatchObject({cash_cents:'15000',open_cents:'5000'});
    const reversed=await snapshot();await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:ids.tenant,actor_id:ids.operator,request_id:randomUUID(),receivable_id:source.target,expected_revision:reversed.revision,action:'reverse',payment_id:paid.payment_id,effective_date:day,refund_kind:'money_returned',reason:'Devolução integral já realizada'}]);
    position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;expect(position).toMatchObject({requires_reallocation:false,unallocated_open_cents:'0'});expect(position.installments[0]).toMatchObject({cash_cents:'0',open_cents:'20000'});
    paymentHistory=(await db.query<{v:{total:number;rows:Array<{action:string;installment_id:string}>}}>('select finance_private.receivable_payment_installment_history($1,$2,$3,0,30,null) v',[ids.tenant,source.target,paid.payment_id])).rows[0].v;expect(paymentHistory.total).toBe(2);expect(paymentHistory.rows.map(row=>row.action)).toEqual(['allocate','reverse']);
    const creditPreview=(await db.query<{v:{revision:string}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[ids.tenant,source.credit,source.target,'10000'])).rows[0].v;
    const creditPayload={version:1,tenant_id:ids.tenant,request_id:randomUUID(),credit_id:source.credit,receivable_id:source.target,application_id:null,action:'apply',amount_cents:'10000',expected_revision:creditPreview.revision,reason:'Aplicação distribuída na parcela',installment_allocations:[{installment_id:installmentB,amount_cents:'10000'}],expected_agreement_revision:position.revision};
    const credit=(await db.query<{v:{application_id:string}}>('select finance_private.record_customer_credit_application($1) v',[creditPayload])).rows[0].v;
    position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;expect(position).toMatchObject({requires_reallocation:false,unallocated_open_cents:'0'});expect(position.installments[1]).toMatchObject({credit_cents:'10000',open_cents:'10000'});
    const adjustmentPreview=(await db.query<{v:{revision:string}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[ids.tenant,source.target,'discount','5000',day])).rows[0].v;
    await db.query('select finance_private.record_receivable_balance_adjustment($1)',[{version:1,tenant_id:ids.tenant,request_id:randomUUID(),receivable_id:source.target,action:'apply',kind:'discount',adjustment_id:null,amount_cents:'5000',effective_on:day,expected_revision:adjustmentPreview.revision,reason:'Desconto contratual distribuído',installment_allocations:[{installment_id:installmentA,amount_cents:'5000'}],expected_agreement_revision:position.revision}]);
    position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;expect(position.installments[0]).toMatchObject({discount_cents:'5000',open_cents:'15000'});
    const nextA=randomUUID(),nextB=randomUUID(),reviseProposal={action:'revise',installments:[{id:nextA,amount_cents:'12500',due_on:'2026-12-10'},{id:nextB,amount_cents:'12500',due_on:'2027-01-10'}]};
    const revisePreview=(await db.query<{v:{revision:string;eligible:boolean}}>('select finance_private.receivable_agreement_context($1,$2,$3) v',[ids.tenant,source.target,reviseProposal])).rows[0].v;expect(revisePreview.eligible).toBe(true);
    await db.query('select finance_private.record_receivable_agreement($1)',[{version:1,tenant_id:ids.tenant,request_id:randomUUID(),receivable_id:source.target,action:'revise',expected_revision:revisePreview.revision,reason:'Revisão do saldo ainda em aberto',installments:reviseProposal.installments}]);
    const history=(await db.query<{v:{total:number;next_offset:number|null;rows:unknown[]}}>('select finance_private.receivable_agreement_history($1,$2,0,1,null) v',[ids.tenant,source.target])).rows[0].v;
    expect(history).toMatchObject({total:2,next_offset:1});expect(history.rows).toHaveLength(1);
    const releasePreview=(await db.query<{v:{revision:string}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,$5) v',[ids.tenant,source.credit,source.target,'10000',credit.application_id])).rows[0].v;
    await db.query('select finance_private.record_customer_credit_application($1)',[{...creditPayload,request_id:randomUUID(),action:'release',application_id:credit.application_id,expected_revision:releasePreview.revision,installment_allocations:undefined,expected_agreement_revision:undefined}]);
    position=(await db.query<{v:any}>('select finance_private.receivable_installment_position($1,$2) v',[ids.tenant,source.target])).rows[0].v;
    expect(position).toMatchObject({status:'active',scheduled_open_cents:'25000',unallocated_open_cents:'10000',requires_reallocation:true});
    expect((await db.query<{n:number}>('select count(*)::int n from receivables')).rows[0].n).toBe(beforeCount);
    await expect(db.query('insert into receivables_payments(tenant_id,receivable_id,amount,received_at,bank_account_id) values($1,$2,1,clock_timestamp(),$3)',[ids.tenant,source.target,ids.account])).rejects.toThrow(/financial_versioned_command_required|finance_agreement_distribution_required/);
    await db.exec('rollback');
  }finally{await db.close();}
},120000);
