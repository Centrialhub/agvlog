import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import type {useLoadDocumentChanges} from '@/hooks/useLoadDocumentChanges';
import {isRecord,parseDocumentChangeContext,type DocumentChangeResult} from '@/lib/loads/documentChanges';
import type {ReplanningTarget} from '@/lib/loads/replanning';
import {getErrorMessage} from '@/lib/errors';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {LocationPicker} from '@/components/maps/LocationPicker';
import type {ResolvedLocation} from '@/lib/geocoding';
export interface DocumentChangeSelection {action:'attach'|'detach';documentIds:string[]}
interface Props {
 api:ReturnType<typeof useLoadDocumentChanges>;loadId:string;selection:DocumentChangeSelection|null;
 onClose:()=>void;onConfirmed:(result:DocumentChangeResult)=>void;onFailure:(message:string)=>void;
}
export function DocumentChangeDialog({api,loadId,selection,onClose,onConfirmed,onFailure}:Props){
 const {currentTenant}=useTenant();const {user}=useAuth();
 const [choice,setChoice]=useState('');const [reason,setReason]=useState('');const [destination,setDestination]=useState('');
 const [location,setLocation]=useState<ResolvedLocation|null>(null);const [error,setError]=useState<string|null>(null);
 const selectionKey=selection?selection.action+':'+selection.documentIds.join(','):'';
 useEffect(()=>{setChoice('');setReason('');setDestination('');setLocation(null);setError(null);},[selectionKey,loadId,currentTenant?.id,user?.id]);
 const query=useQuery({queryKey:['load_document_change_context',currentTenant?.id,user?.id,loadId,selectionKey],
  enabled:!!selection&&!!currentTenant?.id&&!!user?.id,retry:false,staleTime:0,
  queryFn:async({signal})=>{
   const {data,error:failure}=await supabase.rpc('get_load_document_change_context',{
    _tenant_id:currentTenant!.id,_load_id:loadId,_document_ids:selection!.documentIds,
   }).abortSignal(signal);
   if(failure)throw failure;return parseDocumentChangeContext(data,loadId,selection!.documentIds);
  }});
 const trip=query.data?.loads.find(load=>load.id===loadId)?.trip_id;
 const stops=query.data?.stops.filter(stop=>stop.dispatch_trip_id===trip&&stop.status==='pending')??[];
 const unresolved=api.pending.length>0||!!api.recoveryError;
 async function confirmDocumentChange(){
  setError(null);let sent=false;
  try{
   if(!selection||!query.data||!reason.trim())throw new Error('Informe o motivo da alteração.');
   let target:ReplanningTarget|null=null;
   if(selection.action==='attach'){
    if(!choice)throw new Error('Escolha explicitamente o destino dos documentos.');
    if(choice==='new'){
     if(!destination.trim()||!location)throw new Error('Informe o endereço e confirme o ponto no mapa.');
     target={mode:'new',destination:destination.trim(),latitude:location.latitude,longitude:location.longitude,client_id:null,
      location_source:location.source,location_address:location.address||destination.trim(),location_provider:location.provider,
      location_accuracy_m:location.accuracy_m,location_confidence:location.confidence,location_audit:location.audit,geofence_radius_m:500};
    }else target=choice==='unassigned'?{mode:'unassigned'}:{mode:'existing',stop_id:choice};
   }
   sent=true;const result=await api.submit({load_id:loadId,document_ids:selection.documentIds,action:selection.action,
    revision:query.data.revision,reason:reason.trim(),target_stop:target});
   onClose();onConfirmed(result);
  }catch(failure){
   const message=getErrorMessage(failure,'Não foi possível confirmar a alteração.');setError(message);onFailure(message);
   if(sent&&!(isRecord(failure)&&failure.outcome==='rejected'))onClose();
  }
 }
 return <Dialog open={!!selection} onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}>
  <DialogContent><DialogHeader><DialogTitle>{selection?.action==='detach'?'Remover documentos da carga':'Incluir documentos na carga'}</DialogTitle>
   <DialogDescription>{selection?.documentIds.length??0} nota(s). A alteração inclui seus itens e vínculos de parada. Não haverá emissão fiscal nem confirmação de entrega.</DialogDescription>
  </DialogHeader>
  {query.isPending?<p role="status">Consultando composição e paradas…</p>:query.error?<div>
   <p role="alert">{getErrorMessage(query.error,'Falha ao consultar a composição.')}</p><Button variant="outline" onClick={()=>void query.refetch()}>Atualizar composição</Button>
  </div>:<div className="space-y-3">
   {selection?.action==='attach'?<div><Label htmlFor="document-change-target">Destino dos documentos</Label>
    <Select value={choice} onValueChange={setChoice} disabled={api.isPending}>
     <SelectTrigger id="document-change-target"><SelectValue placeholder="Selecione explicitamente"/></SelectTrigger>
     <SelectContent>{trip?<>{stops.map(stop=><SelectItem key={stop.id} value={stop.id}>Parada {stop.stop_order}: {stop.destination}</SelectItem>)}
      <SelectItem value="new">Nova parada com localização</SelectItem></>:<SelectItem value="unassigned">Carga sem viagem: planejar depois</SelectItem>}</SelectContent>
    </Select></div>:<p className="text-sm">Paradas esvaziadas ficarão canceladas no histórico. A nota ficará sem carga, sem apagar seus registros fiscais.</p>}
   {choice==='new'&&selection?.action==='attach'?<>
    <div><Label htmlFor="document-change-address">Destino da nova parada</Label><Input id="document-change-address" value={destination} onChange={e=>setDestination(e.target.value)} disabled={api.isPending}/></div>
    {currentTenant?<LocationPicker tenantId={currentTenant.id} address={destination} value={location}
     onAddressChange={setDestination} onChange={setLocation} disabled={api.isPending}/>:null}
   </>:null}
   <div><Label htmlFor="document-change-reason">Motivo da alteração</Label><Textarea id="document-change-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} disabled={api.isPending}/></div>
   {error?<p role="alert">{error}</p>:null}
   <Button onClick={()=>void confirmDocumentChange()} disabled={api.isPending||unresolved||query.isFetching}>{api.isPending?'Confirmando…':'Confirmar alteração'}</Button>
  </div>}
  </DialogContent>
 </Dialog>;
}
