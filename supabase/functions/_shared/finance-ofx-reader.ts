import {StatementReadError,type StatementSourceRow} from './finance-statement-reader.ts';
const fail=(code:string):never=>{throw new StatementReadError(code);};
type Node={name:string;text:string;children:Node[]};
const containers=new Set(['OFX','SIGNONMSGSRSV1','SONRS','STATUS','FI','BANKMSGSRSV1','STMTTRNRS','STMTRS','BANKACCTFROM','BANKACCTTO','BANKTRANLIST','STMTTRN','LEDGERBAL','AVAILBAL','PAYEE']);
function decode(bytes:Uint8Array){
 if(!bytes.length||bytes.length>10485760)return fail('ofx_file_size');
 const prefix=new TextDecoder('windows-1252').decode(bytes.slice(0,2048));
 const sgml=/^\s*OFXHEADER:100\s/im.test(prefix);let encoding='utf-8';
 if(sgml){
  const header=prefix.split(/<OFX>/i)[0],fields=new Map<string,string>();
  for(const line of header.split(/\r?\n/)){if(!line.trim())continue;const match=line.trim().match(/^([A-Z]+):([^\r\n]+)$/);if(!match||fields.has(match[1]))return fail('ofx_invalid_header');fields.set(match[1],match[2].trim());}
  if(fields.get('DATA')!=='OFXSGML'||fields.get('SECURITY')!=='NONE'||fields.get('COMPRESSION')!=='NONE')return fail('ofx_unsupported_header');
  if(fields.get('ENCODING')==='USASCII'&&fields.get('CHARSET')==='1252')encoding='windows-1252';
  else if(!['UTF-8','UTF8'].includes(fields.get('ENCODING')||''))return fail('ofx_unsupported_encoding');
 }else{
  const declared=prefix.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
  if(declared){if(!['utf-8','windows-1252'].includes(declared))return fail('ofx_unsupported_encoding');encoding=declared;}
 }
 let source:string;try{source=new TextDecoder(encoding,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{return fail('ofx_invalid_encoding');}
 for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);if(code<32&&![9,10,13].includes(code))return fail('ofx_invalid_control_character');}
 if(sgml)source=source.slice(source.search(/<OFX>/i));
 return {source,sgml,encoding};
}
function entities(text:string,sgml:boolean){
 if(!sgml&&/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(text))return fail('ofx_invalid_entity');
 return text.replace(/&([^;\s]+);/g,(_all,key:string)=>{
  const known:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(key in known)return known[key];
  if(!/^#(?:\d+|x[0-9a-f]+)$/i.test(key))return fail('ofx_unknown_entity');
  const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  if(!Number.isInteger(code)||code<32||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return fail('ofx_invalid_entity');return String.fromCodePoint(code);
 });
}
function parseTree(source:string,sgml:boolean){
 const document:Node={name:'#document',text:'',children:[]},stack=[document];let position=0,tags=0;
 for(const match of source.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)){
  if(match.index!==position)return fail('ofx_invalid_markup');position+=match[0].length;const token=match[0];
  if(token.startsWith('<!--'))continue;
  if(token.startsWith('<?')){if(!/^<\?(?:xml|OFX)\s[\s\S]*\?>$/i.test(token)||stack.length!==1||document.children.length)return fail('ofx_invalid_processing_instruction');continue;}
  if(!token.startsWith('<')){if(stack.length===1&&token.trim())return fail('ofx_text_outside_document');stack[stack.length-1].text+=token;if(stack[stack.length-1].text.length>4000)return fail('ofx_field_too_long');continue;}
  if(++tags>300000)return fail('ofx_too_many_elements');
  const closing=token.match(/^<\/([A-Z][A-Z0-9.]*)\s*>$/i);
  if(closing){const name=closing[1].toUpperCase();
   if(sgml&&stack.length>1&&stack[stack.length-1].name!==name&&!containers.has(stack[stack.length-1].name))stack.pop();
   if(stack.length===1||stack[stack.length-1].name!==name)return fail('ofx_unbalanced_elements');stack.pop();continue;
  }
  const opening=token.match(/^<([A-Z][A-Z0-9.]*)\s*(\/?)>$/i);if(!opening)return fail('ofx_unsupported_markup');
  if(sgml&&stack.length>1&&!containers.has(stack[stack.length-1].name))stack.pop();
  const node:Node={name:opening[1].toUpperCase(),text:'',children:[]};stack[stack.length-1].children.push(node);
  if(!opening[2])stack.push(node);if(stack.length>32)return fail('ofx_too_deep');
 }
 if(position!==source.length||stack.length!==1||document.children.length!==1||document.children[0].name!=='OFX')return fail('ofx_incomplete_document');
 const walk=(node:Node)=>{if(node.children.length&&node.text.trim())return fail('ofx_mixed_content');node.text=entities(node.text.trim(),sgml);node.children.forEach(walk);};
 walk(document);return document.children[0];
}
function child(node:Node,name:string,required=true):Node|null{
 const matches=node.children.filter(item=>item.name===name);if(matches.length>1)return fail(`ofx_duplicate_field:${name}`);
 if(!matches.length){if(required)return fail(`ofx_missing_field:${name}`);return null;}return matches[0];
}
function value(node:Node,name:string,required=true){const result=child(node,name,required);if(!result)return null;if(result.children.length||!result.text)return fail(`ofx_invalid_field:${name}`);return result.text;}
export function ofxMoney(raw:string):number{
 const match=raw.match(/^([+-]?)(\d+)(?:\.(\d{1,8}))?$/);if(!match||/[1-9]/.test((match[3]||'').slice(2)))return fail('ofx_fractional_cent');
 const cents=BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0').slice(0,2));if(cents>99999999999999n)return fail('amount_out_of_range');
 return Number(match[1]==='-'?-cents:cents);
}
export function ofxDate(raw:string){
 const match=raw.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?)?(?:\[([+-]?\d{1,2}(?:\.\d{1,2})?)(?::[A-Za-z0-9_+-]+)?\])?$/);
 if(!match)return fail('ofx_invalid_date');const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const hour=Number(match[4]||0),minute=Number(match[5]||0),second=Number(match[6]||0),millisecond=Number((match[7]||'').padEnd(3,'0'));
 const local=new Date(Date.UTC(year,month-1,day,hour,minute,second,millisecond));const offset=match[8]===undefined?null:Number(match[8])*60;
 if(year<1900||year>9999||local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day||hour>23||minute>59||second>59
  ||(offset!==null&&(!Number.isInteger(offset)||Math.abs(offset)>840)))return fail('ofx_invalid_date');
 return {raw,date:`${match[1]}-${match[2]}-${match[3]}`,offset_minutes:offset,precision:match[7]?'millisecond':match[4]?'second':'date',instant:new Date(local.getTime()-(offset??0)*60000).toISOString()};
}
export function readOfxStatement(bytes:Uint8Array){
 const {source,sgml,encoding}=decode(bytes),root=parseTree(source,sgml);
 const signon=child(root,'SIGNONMSGSRSV1',false);
 if(signon){const signonStatus=child(child(signon,'SONRS')!,'STATUS')!;if(value(signonStatus,'CODE')!=='0'||value(signonStatus,'SEVERITY')!=='INFO')return fail('ofx_bank_response_not_successful');}
 const bank=child(root,'BANKMSGSRSV1')!,response=child(bank,'STMTTRNRS')!,status=child(response,'STATUS')!;
 if(value(status,'CODE')!=='0'||value(status,'SEVERITY')!=='INFO')return fail('ofx_bank_response_not_successful');
 if(root.children.some(node=>!['SIGNONMSGSRSV1','BANKMSGSRSV1'].includes(node.name)))return fail('ofx_unsupported_message_set');
 const statement=child(response,'STMTRS')!,currency=value(statement,'CURDEF');if(currency!=='BRL')return fail('ofx_unsupported_currency');
 const account=child(statement,'BANKACCTFROM')!,transactions=child(statement,'BANKTRANLIST')!;
 const start=ofxDate(value(transactions,'DTSTART')!),end=ofxDate(value(transactions,'DTEND')!);if(start.instant>end.instant)return fail('ofx_reversed_period');
 if(transactions.children.some(node=>!['DTSTART','DTEND','STMTTRN'].includes(node.name)))return fail('ofx_unsupported_transaction_element');
 const accountInfo={bank_id:value(account,'BANKID')!,branch_id:value(account,'BRANCHID',false),account_id:value(account,'ACCTID')!,account_type:value(account,'ACCTTYPE')!};
 if(!['CHECKING','SAVINGS','MONEYMRKT'].includes(accountInfo.account_type))return fail('ofx_unsupported_account_type');
 const rows:StatementSourceRow[]=[],dates:ReturnType<typeof ofxDate>[]=[],ids=new Set<string>(),repeatedIds=new Set<string>();let inflow=0n,outflow=0n;
 for(const transaction of transactions.children.filter(node=>node.name==='STMTTRN')){
  if(rows.length>=10000)return fail('too_many_rows');
  if(child(transaction,'CORRECTFITID',false)||child(transaction,'CORRECTACTION',false))return fail('ofx_corrections_require_review');
  const type=value(transaction,'TRNTYPE')!,posted=ofxDate(value(transaction,'DTPOSTED')!),rawAmount=value(transaction,'TRNAMT')!,cents=ofxMoney(rawAmount),id=value(transaction,'FITID')!;
  if(cents===0)return fail('zero_transaction');if((type==='CREDIT'&&cents<0)||(type==='DEBIT'&&cents>0))return fail('ofx_direction_conflict');
  if(!['CREDIT','DEBIT','INT','DIV','FEE','SRVCHG','DEP','ATM','POS','XFER','CHECK','PAYMENT','CASH','DIRECTDEP','DIRECTDEBIT','REPEATPMT','OTHER'].includes(type))return fail('ofx_unsupported_transaction_type');
  const name=value(transaction,'NAME',false),memo=value(transaction,'MEMO',false),check=value(transaction,'CHECKNUM',false);
  if(ids.has(id))repeatedIds.add(id);ids.add(id);dates.push(posted);
  rows.push({posted_on:posted.date,amount_cents:cents,bank_id:id,description:memo||name||type,document_number:check,counterparty_name:name,counterparty_document:null,
   raw:{source_row:rows.length+1,cells:[type,posted.raw,rawAmount,id,name,memo,check]}});
  if(cents>0)inflow+=BigInt(cents);else outflow-=BigInt(cents);
 }
 const ledger=child(statement,'LEDGERBAL',false),available=child(statement,'AVAILBAL',false);
 const balance=(node:Node|null)=>node?{amount_cents:ofxMoney(value(node,'BALAMT')!),as_of:ofxDate(value(node,'DTASOF')!)}:null;
 return {parser_version:'native-ofx-v1' as const,encoding,syntax:sgml?'sgml':'xml',currency:'BRL' as const,account:accountInfo,
  period:{start,end},ledger_balance:balance(ledger),available_balance:balance(available),rows,posted_dates:dates,
  repeated_bank_ids:[...repeatedIds],outside_declared_period:dates.some(date=>date.instant<start.instant||date.instant>end.instant),
  inflow_cents:inflow.toString(),outflow_cents:outflow.toString(),net_cents:(inflow-outflow).toString(),
  opening_balance:null,account_verification:'pending' as const,coverage_verification:'pending' as const};
}
