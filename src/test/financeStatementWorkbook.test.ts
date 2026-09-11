import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
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
  it('honors the workbook 1904 date system instead of silently moving the transaction date',()=>{
    const book=XLSX.utils.book_new();book.Workbook={WBProps:{date1904:true}};
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Data','Descrição','Valor'],[0,'PIX',-500]]),'Extrato');
    const result=readStatementWorkbook(bytes(book),0);
    const parsed=mapStatementMatrix(result.matrix,{header_row:0,date_column:0,description_column:1,amount_column:2,date_format:'excel',number_format:'decimal'},
      {start:'1904-01-01',end:'1904-01-31'},result.date1904);
    expect(parsed.rows[0].posted_on).toBe('1904-01-01');expect(parsed.rows[0].amount_cents).toBe(-50000);
  });
});
