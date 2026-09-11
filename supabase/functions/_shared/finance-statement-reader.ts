export interface StatementMapping {
  header_row:number;sheet_index?:number;delimiter?:';'|','|'\t';number_format:'br'|'decimal';date_format:'dmy'|'ymd'|'excel';
  date_column:number;description_column:number;amount_column?:number;credit_column?:number;debit_column?:number;
  bank_id_column?:number;document_column?:number;counterparty_document_column?:number;counterparty_name_column?:number;balance_column?:number;
  balance_basis?:'before_transaction'|'after_transaction';row_order?:'chronological'|'reverse_chronological';
}
export interface StatementSourceRow {
  posted_on:string;amount_cents:number;bank_id:string|null;description:string;document_number:string|null;
  counterparty_document:string|null;counterparty_name:string|null;raw:{source_row:number;cells:Array<string|number|boolean|null>};
}
export class StatementReadError extends Error {}
const fail=(code:string):never=>{throw new StatementReadError(code);};
export function readStatementCsv(bytes:Uint8Array,delimiter:string):unknown[][] {
  if(![';',',','\t'].includes(delimiter))return fail('delimiter_required');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{return fail('invalid_encoding');}
  const result:unknown[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const flush=()=>{row.push(cell);result.push(row);if(result.length>10021)return fail('too_many_source_rows');row=[];cell='';closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===delimiter){row.push(cell);if(row.length>=100)return fail('too_many_source_columns');cell='';closed=false;continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;flush();continue;}
    if(closed){if(c.trim())return fail('invalid_csv_quotes');continue;}
    if(c==='"'){if(cell.trim())return fail('invalid_csv_quotes');quoted=true;continue;}
    cell+=c;
  }
  if(quoted)return fail('truncated_csv');if(row.length||cell.length||closed)flush();
  return result;
}
function sourceDate(value:unknown,format:StatementMapping['date_format'],date1904:boolean):string{
  if(format==='excel'){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||(!date1904&&Math.floor(value)===60))return fail('invalid_excel_date');
    const serial=Math.floor(value),base=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31);
    const date=new Date(base+(serial-(!date1904&&serial>60?1:0))*86400000);
    if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1900||date.getUTCFullYear()>9999)return fail('invalid_date');
    return date.toISOString().slice(0,10);
  }
  const text=String(value??'').trim(),m=format==='dmy'?text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/):text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return fail('invalid_date');
  const year=Number(format==='dmy'?m[3]:m[1]),month=Number(m[2]),day=Number(format==='dmy'?m[1]:m[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<1900||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return fail('invalid_date');
  return date.toISOString().slice(0,10);
}
export function statementCents(value:unknown,format:StatementMapping['number_format']):number{
  let s=String(value??'').trim(),negative=false;
  if(typeof value==='number'){if(!Number.isFinite(value))return fail('invalid_amount');format='decimal';}
  s=s.replace(/^R\$\s*/,'');
  if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1);}
  if(s.endsWith('-')){if(negative)return fail('invalid_amount');negative=true;s=s.slice(0,-1);}
  if(s.startsWith('-')){if(negative)return fail('invalid_amount');negative=true;s=s.slice(1);}else if(s.startsWith('+'))s=s.slice(1);
  if(format==='br'){
    if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))return fail('invalid_amount');
    s=s.replace(/\./g,'').replace(',','.');
  }else if(!/^\d+(?:\.\d{1,2})?$/.test(s))return fail('invalid_amount');
  const [integer,fraction='']=s.split('.'),amount=BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0'));
  if(amount>99999999999999n)return fail('amount_out_of_range');return Number(negative?-amount:amount);
}
export function mapStatementMatrix(matrix:unknown[][],map:StatementMapping,period:{start:string;end:string},date1904=false):{
  rows:StatementSourceRow[];net_cents:string;inflow_cents:string;outflow_cents:string;balance_rows:number;
}{
  if(!map||!Number.isInteger(map.header_row)||map.header_row<0||map.header_row>19||!['br','decimal'].includes(map.number_format)
    ||!['dmy','ymd','excel'].includes(map.date_format)||!matrix[map.header_row])return fail('invalid_mapping');
  const columns=Object.entries(map).filter(([key,value])=>key.endsWith('_column')&&value!==undefined).map(([,value])=>value);
  if(columns.some(value=>!Number.isInteger(value)||Number(value)<0||Number(value)>99)||map.date_column===undefined||map.description_column===undefined
    ||(map.amount_column===undefined&&map.credit_column===undefined&&map.debit_column===undefined)
    ||(map.amount_column!==undefined&&(map.credit_column!==undefined||map.debit_column!==undefined)))return fail('invalid_mapping');
  const moneyColumns=[map.amount_column,map.credit_column,map.debit_column,map.balance_column].filter((value):value is number=>value!==undefined);
  if(new Set([map.date_column,...moneyColumns]).size!==moneyColumns.length+1)return fail('overlapping_columns');
  const width=matrix[map.header_row].length;
  if(columns.some(value=>Number(value)>=width))return fail('column_out_of_range');
  const rows:StatementSourceRow[]=[];let inflow=0n,outflow=0n,balanceRows=0;
  for(let index=map.header_row+1;index<matrix.length;index++){
    const cells=matrix[index];if(cells.every(cell=>cell==null||String(cell).trim()===''))continue;
    if(cells.slice(width).some(cell=>cell!=null&&String(cell).trim()!==''))return fail(`extra_column:${index+1}`);
    try{
      const posted=sourceDate(cells[map.date_column],map.date_format,date1904);
      if(posted<period.start||posted>period.end)return fail('date_outside_period');
      const text=(column:number|undefined)=>column===undefined?null:String(cells[column]??'').trim()||null;
      let cents:number;
      if(map.amount_column!==undefined)cents=statementCents(cells[map.amount_column],map.number_format);
      else{const credit=text(map.credit_column)?statementCents(cells[map.credit_column!],map.number_format):0;
        const debit=text(map.debit_column)?statementCents(cells[map.debit_column!],map.number_format):0;
        if(credit<0||(credit!==0&&debit!==0))return fail('ambiguous_direction');cents=credit-Math.abs(debit);}
      if(cents===0)return fail('zero_transaction');
      if(map.balance_column!==undefined&&text(map.balance_column)){statementCents(cells[map.balance_column],map.number_format);balanceRows++;}
      const rawCells=cells.map(cell=>cell==null?null:typeof cell==='number'||typeof cell==='boolean'?cell:String(cell));
      rows.push({posted_on:posted,amount_cents:cents,description:text(map.description_column)||'',bank_id:text(map.bank_id_column),document_number:text(map.document_column),
        counterparty_document:text(map.counterparty_document_column),counterparty_name:text(map.counterparty_name_column),raw:{source_row:index+1,cells:rawCells}});
      if(cents>0)inflow+=BigInt(cents);else outflow-=BigInt(cents);
    }catch(error){if(error instanceof StatementReadError)return fail(`${error.message}:row=${index+1}`);throw error;}
    if(rows.length>10000)return fail('too_many_rows');
  }
  if(!rows.length)return fail('no_transactions');
  return {rows,net_cents:(inflow-outflow).toString(),inflow_cents:inflow.toString(),outflow_cents:outflow.toString(),balance_rows:balanceRows};
}
function normalizedRow(value:Record<string,unknown>){
  return {posted_on:value.posted_on,amount_cents:value.amount_cents,description:value.description??'',bank_id:value.bank_id||null,
    document_number:value.document_number||null,counterparty_document:value.counterparty_document||null,counterparty_name:value.counterparty_name||null,raw:canonical(value.raw)};
}
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function compareStatementRows(actual:StatementSourceRow[],proposed:unknown[]){
  const mismatches:number[]=[];
  for(let i=0;i<Math.max(actual.length,proposed.length);i++)if(!actual[i]||!proposed[i]||typeof proposed[i]!=='object'
    ||JSON.stringify(normalizedRow(actual[i] as unknown as Record<string,unknown>))!==JSON.stringify(normalizedRow(proposed[i] as Record<string,unknown>)))mismatches.push(i+1);
  return {matches:mismatches.length===0,mismatch_rows:mismatches};
}
