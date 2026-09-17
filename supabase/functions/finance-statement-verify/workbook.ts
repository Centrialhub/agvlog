import * as XLSX from 'xlsx';
import {StatementReadError} from '../_shared/finance-statement-reader.ts';
const MAX_SHEETS=100,MAX_ROWS=10021,MAX_COLUMNS=100,MAX_CELLS=1_000_000,MAX_TEXT=16384,MAX_SHEET_NAME=128;
const MAX_ZIP_ENTRIES=512,MAX_ZIP_UNCOMPRESSED=32*1024*1024,MAX_ZIP_ENTRY=20*1024*1024,MAX_ZIP_RATIO=200;
const autoMacroName=(name:unknown)=>typeof name==='string'&&/(^|\.)auto_(open|close)$/i.test(name);
const workbookOptions={type:'array' as const,cellDates:false,cellFormula:true,bookVBA:true,sheetRows:MAX_ROWS+1};
const u16=(view:DataView,offset:number)=>view.getUint16(offset,true),u32=(view:DataView,offset:number)=>view.getUint32(offset,true);
function inspectZipContainer(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
 for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(u32(view,offset)===0x06054b50){eocd=offset;break;}
 if(eocd<0||u16(view,eocd+4)!==0||u16(view,eocd+6)!==0)throw new StatementReadError('workbook_container_invalid');
 const diskEntries=u16(view,eocd+8),entries=u16(view,eocd+10),centralSize=u32(view,eocd+12),centralOffset=u32(view,eocd+16);
 if(!entries||diskEntries!==entries||entries===0xffff||entries>MAX_ZIP_ENTRIES||centralSize===0xffffffff||centralOffset===0xffffffff||centralOffset+centralSize>eocd)throw new StatementReadError('workbook_resource_limit');
 let offset=centralOffset,total=0;
 for(let index=0;index<entries;index++){
  if(offset+46>eocd||u32(view,offset)!==0x02014b50)throw new StatementReadError('workbook_container_invalid');
  const flags=u16(view,offset+8),method=u16(view,offset+10),compressed=u32(view,offset+20),uncompressed=u32(view,offset+24),nameLength=u16(view,offset+28),extraLength=u16(view,offset+30),commentLength=u16(view,offset+32),end=offset+46+nameLength+extraLength+commentLength;
  if(end>eocd||flags&1||![0,8].includes(method))throw new StatementReadError('workbook_container_invalid');
  total+=uncompressed;
  if(uncompressed>MAX_ZIP_ENTRY||total>MAX_ZIP_UNCOMPRESSED||uncompressed>compressed*MAX_ZIP_RATIO+1024*1024)throw new StatementReadError('workbook_resource_limit');
  const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength)).replace(/\\/g,'/').toLowerCase();
  if(!name||name.includes('\0')||name.startsWith('/')||/^[a-z]:\//.test(name)||name.split('/').includes('..'))throw new StatementReadError('workbook_container_invalid');
  if(name.endsWith('/vbaproject.bin')||name.includes('/macrosheets/')||name.includes('/intlmacrosheets/'))throw new StatementReadError('workbook_macros_require_review');
  offset=end;
 }
 if(offset!==centralOffset+centralSize)throw new StatementReadError('workbook_container_invalid');
}
function inspectContainer(bytes:Uint8Array){
 const zip=bytes[0]===0x50&&bytes[1]===0x4b,cfb=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((value,index)=>bytes[index]===value);
 if(zip){inspectZipContainer(bytes);return;}
 // Legacy BIFF workbooks are CFB/OLE containers. We do not currently inspect
 // their directory, streams and embedded objects with the same guarantees as
 // OOXML ZIP files, so they must remain quarantined instead of reaching SheetJS.
 if(cfb)throw new StatementReadError('legacy_workbook_requires_review');
 throw new StatementReadError('workbook_container_invalid');
}
function inspectWorkbookStructure(book:ReturnType<typeof XLSX.read>){
 if(!book.SheetNames.length||book.SheetNames.length>MAX_SHEETS||book.SheetNames.some(name=>typeof name!=='string'||!name.length||name.length>MAX_SHEET_NAME))throw new StatementReadError('workbook_resource_limit');
 if(book.vbaraw||book.Workbook?.Names?.some(entry=>autoMacroName(entry?.Name)))throw new StatementReadError('workbook_macros_require_review');
 let cells=0;
 for(const name of book.SheetNames){
  const worksheet=book.Sheets[name];if(!worksheet)throw new StatementReadError('workbook_unreadable');
  if((worksheet['!type'] as unknown)==='macro')throw new StatementReadError('workbook_macros_require_review');
  const reference=worksheet['!fullref']||worksheet['!ref'];if(!reference)continue;
  const range=XLSX.utils.decode_range(reference),rows=range.e.r-range.s.r+1,columns=range.e.c-range.s.c+1;
  if(rows>MAX_ROWS||columns>MAX_COLUMNS||rows*columns>MAX_CELLS||cells+rows*columns>MAX_CELLS)throw new StatementReadError('worksheet_too_large');cells+=rows*columns;
 }
}
export function statementWorkbookNames(bytes:Uint8Array):string[]{
  try{inspectContainer(bytes);return XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames;}catch(error){if(error instanceof StatementReadError)throw error;throw new StatementReadError('workbook_unreadable');}
}
export function readStatementWorkbook(bytes:Uint8Array,sheet:number){
  try{
    if(!Number.isInteger(sheet)||sheet<0)throw new StatementReadError('invalid_sheet');
    inspectContainer(bytes);
    const structure=XLSX.read(bytes,{...workbookOptions,sheetRows:1});inspectWorkbookStructure(structure);
    if(!structure.Sheets[structure.SheetNames[sheet]]?.['!ref'])throw new StatementReadError('sheet_unavailable');
    const book=XLSX.read(bytes,workbookOptions);inspectWorkbookStructure(book);
    for(const name of book.SheetNames){
      const worksheet=book.Sheets[name];
      for(const [key,value] of Object.entries(worksheet)){
        if(key.startsWith('!'))continue;
        const cell=value as {f?:unknown;t?:unknown;v?:unknown};
        if(cell.f!==undefined)throw new StatementReadError('formula_cells_require_review');
        if(cell.t==='e'||typeof cell.v==='number'&&!Number.isFinite(cell.v))throw new StatementReadError('workbook_cell_invalid');
        if(typeof cell.v==='string'&&cell.v.length>MAX_TEXT)throw new StatementReadError('workbook_cell_too_large');
        if(cell.v!==undefined&&cell.v!==null&&!['string','number','boolean'].includes(typeof cell.v))throw new StatementReadError('workbook_cell_invalid');
      }
    }
    const selected=book.Sheets[book.SheetNames[sheet]];
    if(!selected?.['!ref'])throw new StatementReadError('sheet_unavailable');
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(selected,{header:1,defval:null,raw:true,blankrows:true});
    if(matrix.length>MAX_ROWS||matrix.some(row=>!Array.isArray(row)||row.length>MAX_COLUMNS))throw new StatementReadError('worksheet_too_large');
    return {matrix,
      date1904:!!book.Workbook?.WBProps?.date1904,sheetCount:book.SheetNames.length,sheetNames:book.SheetNames};
  }catch(error){if(error instanceof StatementReadError)throw error;throw new StatementReadError('workbook_unreadable');}
}
