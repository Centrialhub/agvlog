/** Calendar month already ended in São Paulo, independent of the device timezone. */
export function previousClosedMoneyMonth(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(now);
 const year=Number(parts.find(part=>part.type==='year')!.value),month=Number(parts.find(part=>part.type==='month')!.value);
 const start=new Date(Date.UTC(year,month-2,1)),end=new Date(Date.UTC(year,month-1,0));
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
