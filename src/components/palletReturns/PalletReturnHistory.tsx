import {Button} from '@/components/ui/button';
import {usePalletHistory} from '@/hooks/usePalletReturns';

const actionLabels:Record<string,string>={created:'Criação',edited:'Edição',status_change:'Mudança de status',cancelled:'Cancelamento'};

export function PalletReturnHistory({protocolId}:{protocolId:string}){
  const history=usePalletHistory(protocolId);
  return <section aria-label="Histórico do protocolo" className="space-y-2 border-t pt-3">
    <h3 className="font-semibold">Histórico do protocolo</h3>
    {history.isLoading&&<p>Carregando histórico…</p>}
    {history.isError&&<div role="alert">Não foi possível consultar o histórico. <Button variant="outline" size="sm" onClick={()=>void history.refetch()}>Tentar novamente</Button></div>}
    {history.isSuccess&&history.data.length===0&&<p>Nenhum evento registrado.</p>}
    {history.isSuccess&&<ol className="max-h-48 space-y-2 overflow-y-auto">{history.data.map(event=><li key={event.id} className="rounded border p-2">
      <p><strong>{actionLabels[event.action]||event.action}</strong> · {new Date(event.created_at).toLocaleString('pt-BR')}</p>
      <p>Autor: {event.created_by||'Não identificado'}</p>
      {event.field_name&&<p>Campo: {event.field_name}</p>}
      {(event.old_value!==null||event.new_value!==null)&&<p>De {event.old_value||'—'} para {event.new_value||'—'}</p>}
      {event.reason&&<p>Motivo: {event.reason}</p>}
      {event.metadata&&typeof event.metadata==='object'&&Object.keys(event.metadata).length>0&&<p>Detalhes: {JSON.stringify(event.metadata)}</p>}
    </li>)}</ol>}
  </section>;
}
