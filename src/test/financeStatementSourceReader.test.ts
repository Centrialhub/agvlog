import {describe,expect,it,vi} from 'vitest';
import {compareStatementRows,mapStatementMatrix,readStatementCsv,statementCents,type StatementMapping} from '../../supabase/functions/_shared/finance-statement-reader';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
import {originalHash} from '../../supabase/functions/secure-upload/statement-original';
const map:StatementMapping={header_row:0,date_column:0,description_column:1,amount_column:2,bank_id_column:3,number_format:'br',date_format:'dmy',delimiter:';'};
const bytes=new TextEncoder().encode('Data;Descrição;Valor;ID\n01/01/2026;PIX;-500,00;ref1\n02/01/2026;Recebimento;100,00;ref2');
const period={start:'2026-01-01',end:'2026-01-31'};
const parsed=()=>mapStatementMatrix(readStatementCsv(bytes,';'),map,period);
describe('explicit statement source interpretation',()=>{
  it('uses configured decimal conventions without guessing',()=>{
    expect(statementCents('1.234','br')).toBe(123400);expect(()=>statementCents('1.234','decimal')).toThrow('invalid_amount');
    expect(statementCents('1,23','br')).toBe(123);expect(statementCents(1.23,'br')).toBe(123);
  });
  it('accounts for all rows and preserves raw cell evidence',()=>{
    expect(parsed()).toMatchObject({net_cents:'-40000',inflow_cents:'10000',outflow_cents:'50000'});
    expect(parsed().rows[0]).toMatchObject({posted_on:'2026-01-01',amount_cents:-50000,bank_id:'ref1',raw:{source_row:2,cells:['01/01/2026','PIX','-500,00','ref1']}});
  });
  it('detects omitted, reordered and altered rows including tampered raw evidence',()=>{
    const rows=parsed().rows;
    expect(compareStatementRows(rows,[...rows].reverse()).matches).toBe(false);
    expect(compareStatementRows(rows,[rows[0]]).mismatch_rows).toEqual([2]);
    expect(compareStatementRows(rows,[{...rows[0],raw:{tampered:true}},rows[1]]).matches).toBe(false);
  });
  it('rejects invalid dates, zero amounts and overlapping money/date columns',()=>{
    expect(()=>mapStatementMatrix([['Data','Desc','Valor'],['31/02/2026','PIX','100']],{...map,bank_id_column:undefined},period)).toThrow('invalid_date');
    expect(()=>mapStatementMatrix([['Data','Desc','Valor'],['01/01/2026','PIX','0']],{...map,bank_id_column:undefined},period)).toThrow('zero_transaction');
    expect(()=>mapStatementMatrix([['Data','Desc','Valor']],{...map,bank_id_column:undefined,amount_column:0},period)).toThrow('overlapping_columns');
  });
});
async function setup(){
  const tenant=crypto.randomUUID(),importId=crypto.randomUUID(),actor=crypto.randomUUID(),hash=await originalHash(bytes);
  const context:StatementSourceContext={revision:'revision',import_data:{id:importId,tenant_id:tenant,file_hash:hash,source_path:`${tenant}/imports/${hash}.csv`,
    parser_version:'mapped-csv-v1',mapping:map,period_start:period.start,period_end:period.end},rows:parsed().rows as unknown as Record<string,unknown>[]};
  return {context,input:{tenant,actor,importId,request:crypto.randomUUID()},deps:{inspect:async()=>context,download:async()=>bytes,
    workbook:vi.fn(),authorize:async()=>true,record:vi.fn().mockResolvedValue({confirmed:true})}};
}
describe('server original verification worker',()=>{
  it('keeps a balance discrepancy visible even when every imported row matches the source',async()=>{
    const {input,deps,context}=await setup();const sourceBytes=new TextEncoder().encode('Data;Descrição;Valor;ID;Saldo\n01/01/2026;PIX;-500,00;ref1;500,00\n02/01/2026;PIX;-100,00;ref2;450,00');
    context.import_data.file_hash=await originalHash(sourceBytes);context.import_data.source_path=`${input.tenant}/imports/${context.import_data.file_hash}.csv`;
    context.import_data.mapping={...map,balance_column:4,balance_basis:'after_transaction',row_order:'chronological'};
    context.rows=mapStatementMatrix(readStatementCsv(sourceBytes,';'),context.import_data.mapping,period).rows as unknown as Record<string,unknown>[];
    deps.download=async()=>sourceBytes;await verifyStatementSource(input,deps);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({outcome:'rows_match',report:expect.objectContaining({balance_check:expect.objectContaining({status:'inconsistent',discrepancy_count:1}),account_coverage_verification:'pending'})}));
  });
  it('attests matching rows while explicitly preserving unresolved coverage and bank identity trust',async()=>{
    const {input,deps}=await setup();await verifyStatementSource(input,deps);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({actor_id:input.actor,outcome:'rows_match',report:expect.objectContaining({matched_rows:2,hash_verified:true,identity_trust:'mapped_unverified',account_coverage_verification:'pending'})}));
  });
  it('records a mismatch instead of accepting altered proposed values',async()=>{
    const {input,deps,context}=await setup();context.rows[0]={...context.rows[0],amount_cents:-45000};await verifyStatementSource(input,deps);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({outcome:'rows_mismatch',report:expect.objectContaining({mismatch_rows:[1]})}));
  });
  it('detects different stored bytes even if a proposed mapping would fit',async()=>{
    const {input,deps}=await setup();deps.download=async()=>new TextEncoder().encode('changed original');await verifyStatementSource(input,deps);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({outcome:'unreadable',report:expect.objectContaining({hash_verified:false,error:'source_hash_mismatch'})}));
  });
  it('does not publish a verification after authorization is revoked during parsing',async()=>{
    const {input,deps}=await setup();deps.authorize=async()=>false;await expect(verifyStatementSource(input,deps)).rejects.toThrow('access_denied');expect(deps.record).not.toHaveBeenCalled();
  });
});
