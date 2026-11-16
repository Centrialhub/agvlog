import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useSonnerToast} from '@/hooks/useSonnerToast';

interface NoteCheck {document_id:string;checked:boolean;revision:number;actor_id:string;recorded_at:string}
const isCheck=(value:unknown):value is NoteCheck=>{
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 return typeof row.document_id==='string'&&typeof row.checked==='boolean'&&Number.isSafeInteger(row.revision)
  &&Number(row.revision)>0&&typeof row.actor_id==='string'&&typeof row.recorded_at==='string';
};
export function useLoadNoteChecks(load:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const toast=useSonnerToast();const client=useQueryClient();
 const tenant=currentTenant?.id;const actor=user?.id;const scope=`${tenant}:${actor}:${load}`;
 const latest=useRef(scope);latest.current=scope;
 const busy=useRef(false);const [saving,setSaving]=useState<string|null>(null);
 const key=['load-note-checks',tenant,actor,load];
 const query=useQuery({queryKey:key,enabled:!!tenant&&!!actor,queryFn:async({signal})=>{
  const {data,error}=await supabase.rpc('get_load_note_checks',{_tenant_id:tenant!,_load_id:load}).abortSignal(signal);
  if(error)throw error;
  if(!Array.isArray(data)||!data.every(isCheck))throw new Error('Resposta de conferência inválida.');
  return data as unknown as NoteCheck[];
 }});
 const rows=new Map((query.data||[]).map(row=>[row.document_id,row]));
 const toggle=async(document:string,checked:boolean)=>{
  if(busy.current||!tenant||!actor||!query.isSuccess||latest.current!==scope)return;
  busy.current=true;setSaving(document);
  try{
   const {data,error}=await supabase.rpc('set_load_note_check',{_tenant_id:tenant,_load_id:load,_document_id:document,
    _checked:checked,_revision:rows.get(document)?.revision||0,_request_id:crypto.randomUUID()}).abortSignal(AbortSignal.timeout(30000));
   if(error)throw error;
   if(!isCheck(data)||data.document_id!==document||data.checked!==checked||data.actor_id!==actor)throw new Error('Resposta de conferência inválida.');
   if(latest.current===scope)toast.success(checked?'Nota conferida e salva.':'Conferência desmarcada e salva.');
  }catch{
   if(latest.current===scope)toast.error('Não foi possível confirmar a gravação. Aguarde a atualização da lista e confira a marcação antes de tentar novamente.');
  }finally{
   await client.invalidateQueries({queryKey:key});busy.current=false;setSaving(null);
  }
 };
 return {rows,saving,blocked:!!saving||!query.isSuccess||query.isFetching,error:query.isError,loading:query.isPending,
  refresh:()=>void query.refetch(),toggle};
}
