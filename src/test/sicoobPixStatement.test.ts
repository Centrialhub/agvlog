import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {inspectStatementLayout,prepareStatementImport} from '@/lib/financial/statementImportClient';
import {mapStatementMatrix,StatementReadError} from '../../supabase/functions/_shared/finance-statement-reader';
import {detectSicoobPixLayout} from '../../supabase/functions/_shared/finance-sicoob-pix-layout';
import {validateQuarantinedData} from '../../supabase/functions/secure-upload/quarantine-validation';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
import {originalHash} from '../../supabase/functions/secure-upload/statement-original';
import {sicoobPixMatrix} from './helpers/sicoobPixFixture';

const period={start:'2026-09-01',end:'2026-09-08'};
const mapping=detectSicoobPixLayout(sicoobPixMatrix())!.mapping;
const parse=(matrix:unknown[][])=>mapStatementMatrix(matrix,mapping,period);
const bytes=(matrix:unknown[][])=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(matrix),'Extrato Pix');
  return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}));
};
describe('Sicoob detailed outgoing Pix report',()=>{
  it('preserves raw dates and row positions while treating positive payments as debits',()=>{
    const parsed=parse(sicoobPixMatrix());
    expect(parsed).toMatchObject({inflow_cents:'0',outflow_cents:'140023',net_cents:'-140023',balance_rows:0});
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({posted_on:'2026-09-01',amount_cents:-15000,bank_id:'E-TEST-1',counterparty_name:'Fornecedor Teste',raw:{source_row:12}});
    expect(parsed.rows[0].raw.cells[0]).toBe('01/09/2026 08:58:37');
    expect(parsed.rows[1].posted_on).toBe('2026-09-08');
  });
  it('only recognizes the complete payment report signature',()=>{
    const matrix=sicoobPixMatrix();matrix[7][2]='Tipo de movimentação: Recebimentos';
    expect(detectSicoobPixLayout(matrix)).toBeNull();
    expect(()=>parse(matrix)).toThrow('invalid_date:row=12');
  });
  it.each(['01/09/2026 24:00:00','01/09/2026 12:60:00','31/09/2026 12:00:00','01/09/2026 12:00:60','01/09/2026 12:00:00 trailing'])(
    'rejects invalid or ambiguous timestamp %s',date=>{
      const matrix=sicoobPixMatrix();matrix[11][0]=date;expect(()=>parse(matrix)).toThrow('invalid_date:row=12');
    });
  it('rejects reversed payment direction and dates outside the selected period',()=>{
    expect(()=>mapStatementMatrix(sicoobPixMatrix(),{...mapping,debit_column:undefined,amount_column:8},period)).toThrow('sicoob_pix_payment_mapping');
    expect(()=>mapStatementMatrix(sicoobPixMatrix(),mapping,{...period,end:'2026-09-07'})).toThrow('date_outside_period');
  });
  it.each(['count','total','omitted','extra','footer','missing summary'])(
    'rejects an incomplete or altered report: %s',change=>{
      const matrix=sicoobPixMatrix();
      if(change==='count')matrix[16][0]='Quantidade de registros: 3';
      if(change==='total')matrix[15][0]='Valor total: R$ 1.400,24';
      if(change==='omitted')matrix[12]=[];
      if(change==='extra')matrix.splice(13,0,[...matrix[11]]);
      if(change==='footer')matrix.push([...matrix[11]]);
      if(change==='missing summary')matrix.splice(14);
      expect(()=>parse(matrix)).toThrow(StatementReadError);
      expect(()=>parse(matrix)).toThrow(/sicoob_pix_(summary_mismatch|invalid_summary)/);
    });
  it('does not skip unexpected content between the transactions and summary',()=>{
    const matrix=sicoobPixMatrix();matrix[13]=['Unexpected data'];expect(()=>parse(matrix)).toThrow('invalid_date:row=14');
  });
  it('prepares an XLSX and verifies the quarantined derivative with the same mapping on the server',async()=>{
    const original=bytes(sicoobPixMatrix()),file=new File([original],'pix.xlsx');
    const layout=await inspectStatementLayout(file,';',0);
    expect('sicoobPix' in layout&&layout.sicoobPix).toMatchObject({mapping,period});
    const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),account=crypto.randomUUID(),request=crypto.randomUUID(),importId=crypto.randomUUID();
    const prepared=await prepareStatementImport(file,{tenant,actor,account,...period,reason:'Conferência Pix'}, {...mapping,sheet_index:0});
    const derived=validateQuarantinedData('xlsx',original,undefined,0);
    if(derived.state!=='validated_data')throw new Error('XLSX derivative unavailable');
    const path=`${tenant}/${request}/validated.json`;
    const context:StatementSourceContext={revision:'r',rows:prepared.pending.command.rows,import_data:{
      id:importId,tenant_id:tenant,bank_account_id:account,source_path:path,file_hash:prepared.pending.command.file_hash,parser_version:'mapped-workbook-v1',
      mapping:prepared.pending.command.mapping,period_start:period.start,period_end:period.end,
      source_snapshot:{artifact:{version:2,tenant_id:tenant,source_type:'bank_account',source_id:account,state:'validated_data',
        original:{sha256:prepared.pending.command.file_hash,format:'xlsx'},
        derivative:{bucket:'upload-validated',path,sha256:await originalHash(derived.bytes),size_bytes:derived.bytes.length,mime:'application/json',method:derived.method,financial_mapping_required:true}}},
    }};
    const record=vi.fn(async()=>({confirmed:true}));
    await verifyStatementSource({tenant,actor,importId,request},{inspect:async()=>context,download:vi.fn(),downloadArtifact:async()=>derived.bytes,workbook:vi.fn(),authorize:async()=>true,record});
    expect(record).toHaveBeenCalledWith(expect.objectContaining({outcome:'rows_match',report:expect.objectContaining({matched_rows:2,outflow_cents:'140023',account_coverage_verification:'pending'})}));
  });
});
