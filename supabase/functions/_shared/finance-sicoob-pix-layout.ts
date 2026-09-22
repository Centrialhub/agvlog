import type {StatementMapping} from './finance-statement-reader.ts';

const text=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const headers=['data/hora movimento','id transacao','historico','destinatario','chave do destinatario','instituicao','descricao','identificador (txid)','valor'];
const nonempty=(row:unknown[])=>row.some(value=>text(value)!=='');

/** Recognize only the bank's detailed outgoing Pix report, never a generic value column. */
export function detectSicoobPixLayout(matrix:unknown[][]){
  const header=matrix.slice(0,20).findIndex(row=>headers.every((name,index)=>text(row[index])===name)&&!row.slice(9).some(value=>text(value)));
  if(header<0)return null;
  const preamble=matrix.slice(0,header).flat().map(text);
  if(!preamble.includes('sicoob')||!preamble.includes('tipo de movimentacao: pagamentos'))return null;
  const dates=preamble.map(value=>value.match(/^periodo: (\d{2})\/(\d{2})\/(\d{4}) ate (\d{2})\/(\d{2})\/(\d{4})$/)).find(Boolean);
  const period=dates?{start:`${dates[3]}-${dates[2]}-${dates[1]}`,end:`${dates[6]}-${dates[5]}-${dates[4]}`}:null;
  const mapping:StatementMapping={header_row:header,date_column:0,description_column:2,debit_column:8,bank_id_column:1,counterparty_name_column:3,number_format:'br',date_format:'dmy'};
  return {mapping,period};
}

/** Only omit the exact summary/footer, and require its controls to match parsed transactions. */
export function sicoobPixSummary(matrix:unknown[][],header:number){
  const index=matrix.findIndex((row,i)=>i>header&&text(row[0])==='resumo');
  if(index<0)return null;
  const footer=matrix.slice(index).filter(nonempty);
  if(footer.length<3||footer.length>4||footer.some(row=>row.slice(1).some(value=>text(value)))
    ||(footer[3]&&!/^ouvidoria bancoob: [\d ()+-]+$/.test(text(footer[3][0]))))return null;
  const amount=String(footer[1][0]??'').trim().match(/^Valor total:\s*(R\$\s*[\d.,]+)$/i);
  const count=text(footer[2][0]).match(/^quantidade de registros: (\d+)$/);
  if(!amount||!count)return null;
  return {index,amount:amount[1],count:Number(count[1])};
}
