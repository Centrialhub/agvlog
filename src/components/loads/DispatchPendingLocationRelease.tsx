import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';

export function DispatchPendingLocationRelease({count,disabled,onRelease}:{count:number;disabled:boolean;onRelease:(reason:string)=>void}){
 const [open,setOpen]=useState(false);
 const [reason,setReason]=useState('Operação autoriza despacho com endereço documental; localização pendente de confirmação em campo.');
 if(!count)return null;
 return <div className="space-y-2 rounded-md border p-3">
  <p className="text-sm">Você pode despachar sem ajustar cada ponto no mapa. Os endereços serão mantidos e os {count} local(is) ficarão pendentes de confirmação.</p>
  {open?<>
   <Label htmlFor="dispatch-location-release-reason">Justificativa da liberação das paradas pendentes</Label>
   <Textarea id="dispatch-location-release-reason" value={reason} disabled={disabled} maxLength={1000}
    onChange={event=>setReason(event.target.value)}/>
   <Button type="button" disabled={disabled||reason.trim().length<20} onClick={()=>onRelease(reason.trim())}>
    Autorizar despacho com {count} local(is) pendente(s)
   </Button>
  </>:<Button type="button" variant="outline" disabled={disabled} onClick={()=>setOpen(true)}>Liberar despacho sem ajustar o mapa</Button>}
 </div>;
}
