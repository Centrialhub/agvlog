export function receivableTotals(rows:ReadonlyArray<{status:string;amount:number;received_amount:number|null;client_invoice_id:string|null}>){
 const sums={pending:0,invoiced:0,received:0};
 for(const row of rows){
  if(row.status==='cancelled')continue;
  const amount=Math.round(Number(row.amount)*100),received=Math.round(Number(row.received_amount||0)*100),open=Math.max(0,amount-received);
  sums.received+=received;if(row.client_invoice_id||row.status==='invoiced')sums.invoiced+=open;else sums.pending+=open;
 }
 return {pending:sums.pending/100,invoiced:sums.invoiced/100,received:sums.received/100};
}
