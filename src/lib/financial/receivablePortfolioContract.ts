import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),count=z.number().int().nonnegative(),cents=z.string().regex(/^\d+$/).nullable();
export const receivablePortfolioSchema=z.object({version:z.literal(1),tenant_id:uuid,from:date.nullable(),to:date.nullable(),client_id:uuid.nullable(),as_of:date,total_titles:count,canceled_titles:count,invalid_titles:count,totals_valid:z.boolean(),nominal_cents:cents,received_allocated_cents:cents,open_cents:cents,overdue_cents:cents,status_rows:z.array(z.object({status:z.string(),count,nominal_cents:cents,received_allocated_cents:cents,open_cents:cents}))}).superRefine((data,ctx)=>{
 const values=[data.nominal_cents,data.received_allocated_cents,data.open_cents,data.overdue_cents,...data.status_rows.flatMap(row=>[row.nominal_cents,row.received_allocated_cents,row.open_cents])];
 if(values.some(value=>data.totals_valid?value===null:value!==null)||data.status_rows.some(row=>row.status==='cancelled')||(data.totals_valid&&data.invalid_titles!==0))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Resumo de carteira inconsistente.'});
 if(data.invalid_titles>data.total_titles||new Set(data.status_rows.map(row=>row.status)).size!==data.status_rows.length||data.status_rows.reduce((sum,row)=>sum+row.count,0)!==data.total_titles)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Contagens da carteira incompatíveis.'});
 if(data.totals_valid&&values.every(value=>value!==null)){
  const balanced=(nominal:string,received:string,open:string)=>BigInt(nominal)===BigInt(received)+BigInt(open);
  if(!balanced(data.nominal_cents!,data.received_allocated_cents!,data.open_cents!)||BigInt(data.overdue_cents!)>BigInt(data.open_cents!)||data.status_rows.some(row=>!balanced(row.nominal_cents!,row.received_allocated_cents!,row.open_cents!)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Saldos da carteira incompatíveis.'});
  for(const key of ['nominal_cents','received_allocated_cents','open_cents'] as const)if(data.status_rows.reduce((sum,row)=>sum+BigInt(row[key]!),0n)!==BigInt(data[key]!))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Gráfico e totais da carteira divergem.'});
 }
});
export type ReceivablePortfolio=z.infer<typeof receivablePortfolioSchema>;
export type PortfolioFilters={from:string|null;to:string|null;client:string|null};
export const portfolioStatusLabels:Record<string,string>={pending:'Pendente',invoiced:'Faturado',partial:'Parcialmente baixado',received:'Baixado integralmente'};
export function portfolioFilters(period:'7d'|'30d'|'90d'|'all',dateFrom:string,dateTo:string,client:string,now=new Date()):PortfolioFilters{
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),start=new Date(`${today}T12:00:00Z`);
 if(period!=='all')start.setUTCDate(start.getUTCDate()-Number(period.slice(0,-1)));
 return {from:dateFrom||(period==='all'?null:start.toISOString().slice(0,10)),to:dateTo||(period==='all'?null:today),client:client==='all'?null:client};
}
