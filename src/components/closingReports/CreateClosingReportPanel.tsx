import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useClosingDraftWrites} from '@/hooks/useClosingDraftWrites';
import {useBuildPreview,REPORT_TYPE_LABELS} from '@/hooks/useClosingReports';
import {periodFromType,type FreightAllocation,type ReportType} from '@/lib/closingReports/closingReportBuilder';
import type {ClosingAttemptPreview} from '@/lib/closingReports/closingAttemptPreview';
import {closingDraftError} from '@/lib/closingReports/closingDraft';
import {ClosingAttemptPreviewView} from './ClosingAttemptPreviewPanel';

const selectClass='h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
interface Props {clients:{id:string;company_name:string}[];vehicles:{id:string;plate:string|null}[];drivers:{id:string;name:string}[]}
export function CreateClosingReportPanel(props:Props){
 const {user}=useAuth();const {currentTenant}=useTenant();const scope=`${currentTenant?.id}:${user?.id}`;
 // Remount even when a caller forgets to key the screen after switching context.
 return <ClosingCreationForm key={scope} {...props}/>;
}
function ClosingCreationForm({clients,vehicles,drivers}:Props){
 const [form,setForm]=useState({clientId:'',payerId:'',title:'',reportType:'custom' as ReportType,periodStart:'',periodEnd:'',
  dateBasis:'invoice_issue' as 'invoice_issue'|'delivery_result',freightAllocation:'per_nf' as FreightAllocation,
  onlyWithCte:false,onlyDelivered:false,expectedPay:'',notes:'',vehicleId:'',driverId:'',reason:''});
 const [snapshot,setSnapshot]=useState<{key:string;preview:ClosingAttemptPreview}|null>(null);
 const [notice,setNotice]=useState('');const [error,setError]=useState('');const sequence=useRef(0);
 const build=useBuildPreview();const api=useClosingDraftWrites();
 const selection={clientId:form.clientId||null,periodStart:form.periodStart,periodEnd:form.periodEnd,dateBasis:form.dateBasis,
  onlyWithCte:form.onlyWithCte,onlyDelivered:form.onlyDelivered,freightAllocation:form.freightAllocation,vehicleId:form.vehicleId||null,driverId:form.driverId||null};
 const selectionKey=JSON.stringify(selection);const currentKey=useRef(selectionKey);currentKey.current=selectionKey;
 const preview=snapshot?.key===selectionKey?snapshot.preview:null;
 const blocked=api.isPending||!!api.pending||!!api.recoveryError;
 const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(previous=>({...previous,[key]:value}));
 const doPreview=async()=>{
  const request=++sequence.current;setSnapshot(null);setNotice('');setError('');
  try{const result=await build.mutateAsync(selection);if(request===sequence.current&&currentKey.current===selectionKey)setSnapshot({key:selectionKey,preview:result});}
  catch(cause){if(request===sequence.current)setError(closingDraftError(cause));}
 };
 const create=async()=>{
  if(!preview||blocked)return;setError('');setNotice('');
  try{
   const result=await api.submit({mode:'system',reason:form.reason,header:{client_id:form.clientId||null,payer_client_id:form.payerId||null,
    title:form.title||`Fechamento ${REPORT_TYPE_LABELS[form.reportType]} ${form.periodStart} a ${form.periodEnd}`,
    report_type:form.reportType,report_model:'detailed',period_start:form.periodStart,period_end:form.periodEnd,
    expected_payment_date:form.expectedPay||null,notes:form.notes||null},
    system:{filters:preview.source_context.filters,revision:preview.source_context.revision,options:{allocation:form.freightAllocation,only_with_cte:form.onlyWithCte}}});
   setSnapshot(null);setNotice(`Rascunho criado: ${result.report.closing_number}. Nenhum faturamento ou pagamento foi executado.`);
  }catch(cause){setError(closingDraftError(cause));}
 };
 return <Card><CardHeader><CardTitle>Dados do fechamento</CardTitle></CardHeader><CardContent className="space-y-4">
  <fieldset disabled={api.isPending} className="grid grid-cols-1 gap-3 md:grid-cols-3">
   <label>Cliente/remetente<select className={selectClass} value={form.clientId} onChange={e=>set('clientId',e.target.value)}><option value="">Todos (conferência)</option>{clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
   <label>Tomador (se diferente)<select className={selectClass} value={form.payerId} onChange={e=>set('payerId',e.target.value)}><option value="">Igual ao remetente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
   <label>Tipo de período<select className={selectClass} value={form.reportType} onChange={e=>{const type=e.target.value as ReportType;const period=periodFromType(type);setForm(f=>({...f,reportType:type,periodStart:period.period_start,periodEnd:period.period_end}));}}>{Object.entries(REPORT_TYPE_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="md:col-span-3">Título<Input maxLength={250} value={form.title} onChange={e=>set('title',e.target.value)}/></label>
   <label>Período início<Input type="date" value={form.periodStart} onChange={e=>set('periodStart',e.target.value)}/></label>
   <label>Período fim<Input type="date" value={form.periodEnd} onChange={e=>set('periodEnd',e.target.value)}/></label>
   <label>Data usada no filtro<select className={selectClass} value={form.dateBasis} onChange={e=>set('dateBasis',e.target.value as typeof form.dateBasis)}><option value="invoice_issue">Emissão da nota</option><option value="delivery_result">Resultado auditado da entrega</option></select></label>
   <label>Vencimento previsto<Input type="date" value={form.expectedPay} onChange={e=>set('expectedPay',e.target.value)}/></label>
   <label>Rateio de frete<select className={selectClass} value={form.freightAllocation} onChange={e=>set('freightAllocation',e.target.value as FreightAllocation)}><option value="per_nf">Frete por NF</option><option value="cte_by_value">Ratear CT-e por valor</option><option value="cte_by_weight">Ratear CT-e por peso</option><option value="first_nf_only">Só na primeira NF do CT-e</option></select></label>
   <div className="space-y-2"><label className="flex gap-2"><input type="checkbox" checked={form.onlyWithCte} onChange={e=>set('onlyWithCte',e.target.checked)}/>Só com CT-e confirmado</label><label className="flex gap-2"><input type="checkbox" checked={form.onlyDelivered} onChange={e=>set('onlyDelivered',e.target.checked)}/>Só entregues integralmente</label></div>
   <label>Filtrar por placa<select className={selectClass} value={form.vehicleId} onChange={e=>set('vehicleId',e.target.value)}><option value="">Todas</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.plate}</option>)}</select></label>
   <label>Filtrar por motorista<select className={selectClass} value={form.driverId} onChange={e=>set('driverId',e.target.value)}><option value="">Todos</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
   <label className="md:col-span-3">Observação<Textarea maxLength={5000} value={form.notes} onChange={e=>set('notes',e.target.value)}/></label>
   <label className="md:col-span-3">Motivo da criação (obrigatório)<Input maxLength={2000} value={form.reason} onChange={e=>set('reason',e.target.value)}/></label>
  </fieldset>
  {api.pending?<p role="alert">Há um pedido sem confirmação. Use “Recuperar fechamento” antes de criar outro.</p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <div className="flex gap-2"><Button disabled={build.isPending||api.isPending} onClick={()=>void doPreview()}>Gerar prévia</Button>
   <Button disabled={!preview?.items.length||blocked||form.reason.trim().length<5} onClick={()=>void create()}>Salvar rascunho</Button></div>
  {preview?<ClosingAttemptPreviewView preview={preview} isFetching={build.isPending||api.isPending} onRefresh={()=>void doPreview()}/>:null}
 </CardContent></Card>;
}
