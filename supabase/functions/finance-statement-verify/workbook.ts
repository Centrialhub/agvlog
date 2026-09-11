import * as XLSX from 'xlsx';
import {StatementReadError} from '../_shared/finance-statement-reader.ts';
export function statementWorkbookNames(bytes:Uint8Array):string[]{
  try{return XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames;}catch{throw new StatementReadError('workbook_unreadable');}
}
export function readStatementWorkbook(bytes:Uint8Array,sheet:number){
  try{
    if(!Number.isInteger(sheet)||sheet<0)throw new StatementReadError('invalid_sheet');
    const book=XLSX.read(bytes,{type:'array',cellDates:false,cellFormula:true}),selected=book.Sheets[book.SheetNames[sheet]];
    if(!selected?.['!ref'])throw new StatementReadError('sheet_unavailable');
    const range=XLSX.utils.decode_range(selected['!ref']);
    if(range.e.r>10020||range.e.c>99)throw new StatementReadError('worksheet_too_large');
    if(Object.entries(selected).some(([key,cell])=>!key.startsWith('!')&&cell?.f))throw new StatementReadError('formula_cells_require_review');
    return {matrix:XLSX.utils.sheet_to_json<unknown[]>(selected,{header:1,defval:null,raw:true,blankrows:true}),
      date1904:!!book.Workbook?.WBProps?.date1904,sheetCount:book.SheetNames.length,sheetNames:book.SheetNames};
  }catch(error){if(error instanceof StatementReadError)throw error;throw new StatementReadError('workbook_unreadable');}
}
