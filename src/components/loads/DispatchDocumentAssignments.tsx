import {useState} from 'react';
import {Label} from '@/components/ui/label';

interface StopAssignment {destination:string;fiscal_document_ids:string[]}
export function assignDispatchDocument<T extends StopAssignment>(stops:T[],documentId:string,value:string):T[]{
 if(!/^(0|[1-9][0-9]*|-1)$/.test(value))return stops;
 const index=Number(value);if(index>=stops.length)return stops;
 return stops.map((stop,n)=>({...stop,fiscal_document_ids:n===index
  ? [...stop.fiscal_document_ids.filter(id=>id!==documentId),documentId]
  : stop.fiscal_document_ids.filter(id=>id!==documentId)}));
}
export function DispatchDocumentAssignments({stops,documents,disabled,onAssign}:{stops:StopAssignment[];
 documents:Array<{id:string;label:string}>;disabled:boolean;onAssign:(documentId:string,value:string)=>void}){
 const [expanded,setExpanded]=useState(false);
 const assigned=documents.filter(d=>stops.some(s=>s.fiscal_document_ids.includes(d.id))).length;
 return <details onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary className="cursor-pointer text-sm">Notas distribuídas automaticamente — revisar vinculação ({assigned} de {documents.length})</summary>
  {expanded?documents.map((document,index)=><div key={document.id}>
   <Label htmlFor={`dispatch-document-${index}`}>Documento {document.label}</Label>
   <select id={`dispatch-document-${index}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm"
    disabled={disabled} value={String(stops.findIndex(stop=>stop.fiscal_document_ids.includes(document.id)))}
    onChange={event=>onAssign(document.id,event.currentTarget.value)}>
    <option value="-1">Sem parada</option>
    {stops.map((stop,n)=><option key={n} value={String(n)}>Parada {n+1}: {stop.destination||'Sem destino'}</option>)}
   </select>
  </div>):null}
 </details>;
}
