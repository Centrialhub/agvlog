import {expenseCategories,newExpenseLine,type ExpenseBatchDraft,type ExpenseLineDraft} from './expenseBatchContract';
export type PastedExpense={category:ExpenseLineDraft['category'];description:string;amount:string;date:string;supplierName:string;document:string;dueDate:string};
export type ExpensePastePreview={rows:Array<{line:number;value:PastedExpense|null;errors:string[]}>;errors:string[];totalCents:string;count:number};
const normalize=(v:string)=>v.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const categories=new Map(Object.entries(expenseCategories).flatMap(([key,label]):Array<[string,string]>=>[[normalize(key),key],[normalize(label),key]]));
/** Exact decimal input, never binary rounding or spreadsheet formula evaluation. */
function money(value:string):{amount:string;cents:string}|null{
 const raw=value.trim().replace(/^R\$\s*/, '');let decimal:string;
 if(/^(?:0|[1-9]\d*)(?:,\d{1,2})?$/.test(raw))decimal=raw.replace(',','.');
 else if(/^[1-9]\d{0,2}(?:\.\d{3})+,\d{1,2}$/.test(raw))decimal=raw.replace(/\./g,'').replace(',','.');
 else if(/^(?:0|[1-9]\d*)\.\d{1,2}$/.test(raw))decimal=raw;
 else return null;
 const [whole,fraction='']=decimal.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(cents<=0n||cents>99999999999999n)return null;
 return{amount:`${whole},${fraction.padEnd(2,'0')}`,cents:cents.toString()};
}
function day(value:string):string|null{const raw=value.trim(),br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw),iso=br?`${br[3]}-${br[2]}-${br[1]}`:raw;if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||iso<'0001-01-01')return null;const date=new Date(`${iso}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;}
/** Excel/Sheets TSV quoting: tabs/newlines inside double-quoted cells and escaped quotes. */
function cells(text:string):string[][]{const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;const input=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');for(let n=0;n<input.length;n++){const char=input[n];if(quoted){if(char==='"'){if(input[n+1]==='"'){cell+='"';n++;}else{quoted=false;closed=true;}}else cell+=char;continue;}if(char==='"'&&!cell&&!closed){quoted=true;continue;}if(char==='\t'||char==='\n'){row.push(cell);cell='';closed=false;if(char==='\n'){rows.push(row);row=[];}continue;}if(closed)throw Error('Há texto após o fechamento de uma célula entre aspas.');cell+=char;}if(quoted)throw Error('Uma célula entre aspas não foi fechada.');row.push(cell);rows.push(row);while(rows.length&&rows[rows.length-1].every(v=>v.trim()===''))rows.pop();return rows;}
export function previewExpensePaste(text:string,context:ExpenseBatchDraft['context'],existingCount:number):ExpensePastePreview{
 const result:ExpensePastePreview={rows:[],errors:[],totalCents:'0',count:0};if(text.length>262144){result.errors.push('A colagem excede 256 mil caracteres. Divida a planilha.');return result;}
 let parsed:string[][];try{parsed=cells(text);}catch(error){result.errors.push(error instanceof Error?error.message:'Formato TSV inválido.');return result;}
 const header=['categoria','descricao','valor','data','fornecedor','documento','vencimento'];let first=0;
 if(normalize(parsed[0]?.[0]??'')==='categoria'){if(parsed[0].length<4||parsed[0].length>7||parsed[0].some((v,n)=>normalize(v)!==header[n]))result.errors.push('Cabeçalho esperado: Categoria, Descrição, Valor, Data, Fornecedor, Documento, Vencimento.');first=1;}
 result.count=parsed.length-first;if(!result.count)result.errors.push('Cole pelo menos uma linha de gasto.');if(result.count+existingCount>200)result.errors.push(`O lote comporta 200 gastos; já existem ${existingCount} e foram colados ${result.count}.`);if(result.count>200)return result;
 let total=0n;for(let index=first;index<parsed.length;index++){const row=parsed[index],errors:string[]=[];const [categoryRaw='',description='',amountRaw='',dateRaw='',supplierName='',document='',dueRaw='']=row;const category=categories.get(normalize(categoryRaw)) as PastedExpense['category']|undefined,amount=money(amountRaw),date=day(dateRaw),dueDate=dueRaw.trim()?day(dueRaw):'';
 if(row.length<4||row.length>7)errors.push('Use de quatro a sete colunas, separadas por tabulação.');if(description.trim().length>1000)errors.push('A descrição deve ter no máximo 1.000 caracteres.');if(row.some(v=>/^[=+@]/.test(v.trim())))errors.push('Cole valores, sem fórmulas de planilha.');if(!category)errors.push('Categoria desconhecida.');if(category==='unloading'&&context!=='trip')errors.push('Descarga exige contexto de viagem.');if(!description.trim())errors.push('Descrição obrigatória.');if(!amount)errors.push('Valor positivo com até duas casas decimais; use vírgula decimal (ex.: 1.234,56).');if(!date)errors.push('Data inválida; use dd/MM/aaaa ou aaaa-mm-dd.');if(dueDate===null)errors.push('Vencimento inválido.');
 const value=errors.length?null:{category:category!,description:description.trim(),amount:amount!.amount,date:date!,supplierName:supplierName.trim(),document:document.trim(),dueDate:dueDate!};if(value)total+=BigInt(amount!.cents);result.rows.push({line:index+1,value,errors});}
 result.totalCents=total.toString();return result;
}
export function appendPastedExpenses(draft:ExpenseBatchDraft,rows:PastedExpense[],makeLine:(context:ExpenseBatchDraft['context'])=>ExpenseLineDraft=newExpenseLine):ExpenseBatchDraft{
 if(!rows.length||draft.lines.length+rows.length>200)throw Error('A inclusão excede o limite de 200 gastos.');const ids=new Set(draft.lines.map(r=>r.id));const lines=rows.map(row=>{const line=makeLine(draft.context);if(ids.has(line.id))throw Error('Não foi possível criar identificações exclusivas para os gastos.');ids.add(line.id);return{...line,...row,supplier:null,center:null,delivery:null,allocations:[],preparedReceipt:null,receiptPath:'',receiptName:'',noReceiptReason:''};});return{...draft,lines:[...draft.lines,...lines]};
}
