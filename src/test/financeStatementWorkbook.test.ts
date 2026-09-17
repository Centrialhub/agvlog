import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {prepareStatementImport} from '@/lib/financial/statementImportClient';
import {readStatementWorkbook} from '../../supabase/functions/finance-statement-verify/workbook';
import {mapStatementMatrix} from '../../supabase/functions/_shared/finance-statement-reader';
function workbook(){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Data','Descrição','Valor'],['01/01/2026','PIX',-500]]),'Extrato');return book;}
const bytes=(book:XLSX.WorkBook)=>new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}));
describe('statement workbook source adapter',()=>{
  it('reads the selected sheet and preserves evidence of additional sheets for coverage review',()=>{
    const book=workbook();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Outra conta']]),'Conta 2');
    const result=readStatementWorkbook(bytes(book),0);expect(result.sheetCount).toBe(2);
    expect(result.matrix[1]).toEqual(['01/01/2026','PIX',-500]);
    expect(()=>readStatementWorkbook(bytes(book),3)).toThrow('sheet_unavailable');
  });
  it('rejects cached formula values rather than certifying a computed value as original bank evidence',()=>{
    const book=workbook();book.Sheets.Extrato.C2={t:'n',v:-500,f:'-100*5'};
    expect(()=>readStatementWorkbook(bytes(book),0)).toThrow('formula_cells_require_review');
  });
  it('rejects formulas and auto-run macro names outside the selected sheet',()=>{
    const formulaBook=workbook();const hidden=XLSX.utils.aoa_to_sheet([['hidden']]);hidden.A2={t:'n',v:2,f:'1+1'};hidden['!ref']='A1:A2';
    XLSX.utils.book_append_sheet(formulaBook,hidden,'Oculta');formulaBook.Workbook={Sheets:[{}, {Hidden:1}]};
    expect(()=>readStatementWorkbook(bytes(formulaBook),0)).toThrow('formula_cells_require_review');
    const macroBook=workbook();macroBook.Workbook={Names:[{Name:'Auto_Open',Ref:'Extrato!$A$1'}]};
    expect(()=>readStatementWorkbook(bytes(macroBook),0)).toThrow('workbook_macros_require_review');
  });
  it('rejects oversized ranges, error cells and non-finite numeric cells',()=>{
    const oversized=workbook();oversized.Sheets.Extrato['!ref']='A1:CW2';expect(()=>readStatementWorkbook(bytes(oversized),0)).toThrow('worksheet_too_large');
    const errorBook=workbook();errorBook.Sheets.Extrato.D2={t:'e',v:0};errorBook.Sheets.Extrato['!ref']='A1:D2';expect(()=>readStatementWorkbook(bytes(errorBook),0)).toThrow('workbook_cell_invalid');
    const nonFinite=workbook();nonFinite.Sheets.Extrato.C2={t:'n',v:Number.POSITIVE_INFINITY};expect(()=>readStatementWorkbook(bytes(nonFinite),0)).toThrow('workbook_cell_invalid');
  });
  it('rejects an XLSX archive claiming excessive expansion before workbook parsing',()=>{
    const source=bytes(workbook()),inflated=source.slice(),view=new DataView(inflated.buffer);let central=-1;
    for(let offset=0;offset<=inflated.length-46;offset++)if(view.getUint32(offset,true)===0x02014b50){central=offset;break;}
    expect(central).toBeGreaterThanOrEqual(0);view.setUint32(central+24,41*1024*1024,true);
    expect(()=>readStatementWorkbook(inflated,0)).toThrow('workbook_resource_limit');
  });
  it('rejects a mismatched XLSX central-directory size',()=>{
    const invalid=bytes(workbook()).slice(),view=new DataView(invalid.buffer);let eocd=-1;
    for(let offset=invalid.length-22;offset>=Math.max(0,invalid.length-65557);offset--)if(view.getUint32(offset,true)===0x06054b50){eocd=offset;break;}
    expect(eocd).toBeGreaterThanOrEqual(0);view.setUint32(eocd+12,view.getUint32(eocd+12,true)-1,true);
    expect(()=>readStatementWorkbook(invalid,0)).toThrow('workbook_container_invalid');
  });
  it('fails closed for legacy CFB/XLS until its streams can be inspected safely',()=>{
    const legacy=new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1,0,0,0,0]);
    expect(()=>readStatementWorkbook(legacy,0)).toThrow('legacy_workbook_requires_review');
    expect(()=>readStatementWorkbook(new TextEncoder().encode('not-a-workbook'),0)).toThrow('workbook_container_invalid');
  });
  it('honors the workbook 1904 date system instead of silently moving the transaction date',()=>{
    const book=XLSX.utils.book_new();book.Workbook={WBProps:{date1904:true}};
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Data','Descrição','Valor'],[0,'PIX',-500]]),'Extrato');
    const result=readStatementWorkbook(bytes(book),0);
    const parsed=mapStatementMatrix(result.matrix,{header_row:0,date_column:0,description_column:1,amount_column:2,date_format:'excel',number_format:'decimal'},
      {start:'1904-01-01',end:'1904-01-31'},result.date1904);
    expect(parsed.rows[0].posted_on).toBe('1904-01-01');expect(parsed.rows[0].amount_cents).toBe(-50000);
  });
  it('prepares a real XLSX through the browser import contract',async()=>{
    const file=new File([bytes(workbook())],'extrato-banco.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),account=crypto.randomUUID();
    const prepared=await prepareStatementImport(file,{tenant,actor,account,start:'2026-01-01',end:'2026-01-31',reason:'Conferência do extrato Excel'},
      {header_row:0,sheet_index:0,date_column:0,description_column:1,amount_column:2,date_format:'dmy',number_format:'decimal'});
    expect(prepared.pending.command).toMatchObject({tenant_id:tenant,bank_account_id:account,file_name:'extrato-banco.xlsx',parser_version:'mapped-workbook-v1',period_start:'2026-01-01',period_end:'2026-01-31'});
    expect(prepared.pending.command.source_path).toMatch(new RegExp(`^${tenant}/imports/[a-f0-9]{64}\\.xlsx$`));
    expect(prepared.pending.command.rows).toEqual([expect.objectContaining({posted_on:'2026-01-01',description:'PIX',amount_cents:-50000})]);
    expect(prepared.totals).toEqual({inflow_cents:'0',outflow_cents:'50000',net_cents:'-50000'});
  });
});
