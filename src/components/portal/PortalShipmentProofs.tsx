import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import type {ShipmentProof} from '@/hooks/portal/usePortalShipmentDetail';
interface Props {current:ShipmentProof[];history:ShipmentProof[];canDownload:boolean;pending:boolean;onDownload:(id:string)=>Promise<void>}
const date=(value?:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'Horário não informado';
export function PortalShipmentProofs({current,history,canDownload,pending,onDownload}:Props){
 const proof=(item:ShipmentProof,historical:boolean)=><div key={item.id} className="flex items-center justify-between border rounded-md p-2">
  <div>
   <p className="font-medium">{historical?'Comprovante anterior':'Comprovante atual'}{item.version?` — versão ${item.version}`:''}</p>
   <p className="text-[10px] text-muted-foreground">{date(item.received_at)} · {item.status}</p>
   {item.receiver_name?<p className="text-[10px]">Recebedor: {item.receiver_name}</p>:null}
   {historical?<p className="text-[10px] text-muted-foreground">Substituído em {date(item.retired_at)}. Não confirma a tentativa atual.</p>:null}
  </div>
  <div className="flex items-center gap-2">
   <Badge variant="outline" className="text-[10px]">{historical?'Histórico':item.status}</Badge>
   {canDownload&&item.has_file?<Button size="sm" variant="outline" disabled={pending}
    aria-label={`Baixar comprovante ${historical?'anterior':'atual'}${item.version?` versão ${item.version}`:''}`}
    onClick={()=>void onDownload(item.id)}><Download className="h-3.5 w-3.5 mr-1"/>Baixar</Button>:null}
   {!item.has_file?<span className="text-[10px] text-muted-foreground">Arquivo pendente</span>:null}
  </div>
 </div>;
 return <div className="space-y-4">
  <section aria-label="Comprovantes atuais" className="space-y-2"><h3 className="font-semibold">Comprovante atual</h3>
   {current.length?current.map(item=>proof(item,false)):<p className="text-muted-foreground">Nenhum comprovante atual anexado.</p>}
  </section>
  {history.length?<section aria-label="Versões anteriores dos comprovantes" className="space-y-2">
   <h3 className="font-semibold">Versões anteriores</h3><p className="text-muted-foreground">Evidências preservadas de registros anteriores.</p>
   {history.map(item=>proof(item,true))}
  </section>:null}
 </div>;
}
