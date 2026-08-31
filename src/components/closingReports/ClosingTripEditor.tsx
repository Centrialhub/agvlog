import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter,DialogDescription} from '@/components/ui/dialog';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useUpdateClosingReportItem,type ClosingReportRow} from '@/hooks/useClosingReports';
import {supabase} from '@/integrations/supabase/client';
import {closingDraftError} from '@/lib/closingReports/closingDraft';
import {closingTripFieldsSchema,localDateTime,type ClosingTripFields} from '@/lib/closingReports/closingTrip';
import type {Tables} from '@/integrations/supabase/types';
type Row=Tables<'closing_report_items'>;
type Edit=Record<keyof ClosingTripFields,string>;
const editable=(row:ClosingTripFields):Edit=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)])) as Edit;
const numericFields=['km_initial','km_final','fuel_liters','fuel_unit_price'] as const;
const labels:Record<keyof ClosingTripFields,string>={km_initial:'KM inicial',km_final:'KM final',fuel_liters:'Litros',fuel_unit_price:'Preço por litro',
 vehicle_plate:'Placa',driver_name:'Motorista',departure_at:'Saída',arrival_at_ts:'Chegada',route_label:'Rota',route_complement:'Complemento da rota'};
export function ClosingTripEditor({report,onClose}:{report:ClosingReportRow;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();
 if(report.tenant_id!==currentTenant?.id)return null;
 return <TripForm key={`${currentTenant.id}:${user?.id}:${report.id}`} report={report} onClose={onClose}/>;
}
function TripForm({report,onClose}:{report:ClosingReportRow;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();const api=useUpdateClosingReportItem();
 const [rows,setRows]=useState<Row[]>([]);const [edits,setEdits]=useState<Record<string,Edit>>({});const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;setLoading(true);
  void (async()=>{try{
   const {data,error:cause}=await supabase.from('closing_report_items').select('*').eq('closing_report_id',report.id).eq('tenant_id',report.tenant_id).order('sort_order').abortSignal(controller.signal);
   if(cause)throw cause;if(!active)return;
   const seen=new Set<string>();const selected=(data??[]).filter(row=>{const key=row.load_id||row.id;if(seen.has(key))return false;seen.add(key);return true;});
   setRows(selected);setEdits(Object.fromEntries(selected.map(row=>[row.id,editable(closingTripFieldsSchema.parse(row))])));
  }catch(cause){if(active)setError(closingDraftError(cause));}finally{if(active)setLoading(false);}})();
  return()=>{active=false;controller.abort();};
 },[report.id,report.tenant_id,currentTenant?.id,user?.id]);
 const save=async(row:Row)=>{
  setError('');setNotice('');try{
   const values=edits[row.id];const expected=closingTripFieldsSchema.parse(row);
   const next=closingTripFieldsSchema.parse({...values,...Object.fromEntries(numericFields.map(key=>[key,values[key]===''?null:Number(values[key])])),
    ...Object.fromEntries(Object.keys(labels).filter(key=>!numericFields.includes(key as typeof numericFields[number])).map(key=>[key,values[key as keyof Edit]||null]))});
   const patch=Object.fromEntries(Object.entries(next).filter(([key,value])=>value!==expected[key as keyof ClosingTripFields]));
   const result=await api.mutateAsync({itemId:row.id,closingReportId:report.id,expected,patch});if(!alive.current)return;
   setRows(previous=>previous.map(item=>item.id===row.id?{...item,...result}:item));setEdits(previous=>({...previous,[row.id]:editable(result)}));setNotice('Dados de viagem confirmados.');
  }catch(cause){if(alive.current)setError(closingDraftError(cause));}
 };
 return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Editar viagens — {report.closing_number}</DialogTitle>
  <DialogDescription>Quilometragem e combustível são informados por carga. Identificação e horários operacionais permanecem na origem.</DialogDescription></DialogHeader>
  <div className="max-h-[65vh] space-y-4 overflow-auto">{loading?<p role="status">Carregando viagens…</p>:null}
   {rows.map(row=><fieldset disabled={api.isPending||!['draft','reviewing'].includes(report.status)} key={row.id} className="grid gap-3 rounded border p-3 md:grid-cols-3"><legend>Carga {row.load_number||'sem vínculo'} · item {row.sort_order}</legend>
    {Object.entries(labels).map(([key,label])=>{const field=key as keyof Edit;const timestamp=field==='departure_at'||field==='arrival_at_ts';
     const numeric=numericFields.includes(field as typeof numericFields[number]);const readonly=row.source_type==='system'&&['vehicle_plate','driver_name','departure_at','arrival_at_ts'].includes(field);
     return <label key={field}>{label}<Input aria-label={`${label} da carga ${row.load_number||row.sort_order}`} readOnly={readonly} type={timestamp?'datetime-local':numeric?'number':'text'} step={numeric?'any':undefined} min={numeric?0:undefined}
      value={timestamp?localDateTime(edits[row.id]?.[field]||null):edits[row.id]?.[field]||''} onChange={e=>{const value=timestamp&&e.target.value?new Date(e.target.value).toISOString():e.target.value;setEdits(previous=>({...previous,[row.id]:{...previous[row.id],[field]:value}}));}}/></label>;
    })}<Button onClick={()=>void save(row)}>Salvar dados da carga {row.load_number||row.sort_order}</Button>
   </fieldset>)}
   {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  </div><DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
 </DialogContent></Dialog>;
}
