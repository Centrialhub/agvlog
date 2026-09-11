import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readNativeStatementAccount} from '@/lib/financial/ledgerClient';
import {nativeAccountLabels,nativeAccountFields} from '@/lib/financial/nativeStatementAccountContract';
export function NativeStatementAccount({tenant,actor,statement,account}:{tenant:string;actor:string;statement:string;account:string}){
 const [open,setOpen]=useState(false);
 const query=useQuery({queryKey:['finance-native-account',tenant,actor,statement,account],enabled:open,retry:false,
  queryFn:()=>readNativeStatementAccount(tenant,statement,account)}),data=query.error?undefined:query.data;
 if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Conferir identificação da conta</Button>;
 return <section aria-label="Identificação nativa da conta" className="space-y-3 rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2">
  <h2 className="font-semibold">Identificação nativa da conta</h2><Button variant="ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar conferência da conta</Button></div>
  {query.isPending&&<p role="status">Comparando os dados do arquivo com o cadastro…</p>}{query.error&&<p role="alert">Não foi possível conferir a identificação da conta.</p>}
  {data&&<><p className="font-medium" role={['mismatch','ambiguous'].includes(data.status)?'alert':undefined}>{nativeAccountLabels[data.status]} · {data.account_name}</p>
   {data.checks.length>0&&<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Dado</th><th className="p-2">No arquivo original</th><th className="p-2">No cadastro</th><th className="p-2">Conferência</th></tr></thead>
    <tbody>{data.checks.map(row=><tr key={row.field} className="border-t"><th className="p-2">{nativeAccountFields[row.field]}</th><td className="p-2">{row.file_value||'Não informado'}</td><td className="p-2">{row.registered_value||'Não informado'}</td><td className="p-2">{row.status==='matched'?'Corresponde':row.status==='different'?'Divergente':'Incompleto'}</td></tr>)}</tbody></table></div>}
   <p className="text-sm">A comparação preserva zeros e dígitos da identificação. Correspondência com o cadastro não confirma a autenticidade do arquivo perante o banco nem a cobertura ou o saldo do período.</p>
  </>}
 </section>;
}
