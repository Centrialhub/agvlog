import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useClosingDraftWrites} from '@/hooks/useClosingDraftWrites';
import {closingDraftError} from '@/lib/closingReports/closingDraft';
import type {LegacyImport} from '@/lib/closingReports/closingReportImporter';

export function ClosingImportPanel(){
 const {user}=useAuth();const {currentTenant}=useTenant();
 return <ImportForm key={`${currentTenant?.id}:${user?.id}`}/>;
}
function ImportForm(){
 const api=useClosingDraftWrites();const sequence=useRef(0);
 const [source,setSource]=useState<{fileName:string;data:LegacyImport}|null>(null);
 const [period,setPeriod]=useState({start:'',end:''});const [reason,setReason]=useState('');
 const [reading,setReading]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>()=>{sequence.current++;},[]);
 const read=async(file?:File)=>{
  const request=++sequence.current;setSource(null);setError('');setNotice('');if(!file)return;setReading(true);
  try{
   if(file.size>5*1024*1024)throw new Error('Use uma planilha de até 5 MB e no máximo 500 linhas.');
   const [{parseLegacyWorkbook},buffer]=await Promise.all([import('@/lib/closingReports/closingReportImporter'),file.arrayBuffer()]);
   const data=parseLegacyWorkbook(buffer);if(request!==sequence.current)return;
   if(data.model==='unknown')throw new Error('Modelo não reconhecido. Confira os cabeçalhos da planilha.');
   const rows=data.model==='summary'?data.summaryRows:data.detailedRows;
   if(!rows.length||rows.length>500)throw new Error('A importação deve conter entre 1 e 500 linhas.');
   setSource({fileName:file.name,data});setPeriod({start:data.period_start||'',end:data.period_end||''});
  }catch(cause){if(request===sequence.current)setError(closingDraftError(cause));}
  finally{if(request===sequence.current)setReading(false);}
 };
 const submit=async()=>{
  const data=source?.data;if(!source||!data||data.model==='unknown')return;setError('');setNotice('');
  try{
   const result=await api.submit({mode:'spreadsheet',reason,
    header:{title:data.title||`Importação ${source.fileName}`,report_type:'custom',report_model:data.model,client_id:null,payer_client_id:null,
     period_start:period.start,period_end:period.end},
    import:data.model==='summary'?{model:'summary',file_name:source.fileName,rows:data.summaryRows}:{model:'detailed',file_name:source.fileName,rows:data.detailedRows}});
   setSource(null);setNotice(`Rascunho importado: ${result.report.closing_number}. Exige conciliação antes de fechar ou faturar.`);
  }catch(cause){setError(closingDraftError(cause));}
 };
 return <Card><CardHeader><CardTitle>Importar planilha legada</CardTitle></CardHeader><CardContent className="space-y-3">
  <p>Dados importados não comprovam entregas nem vínculos fiscais. O rascunho ficará bloqueado para faturamento até a conciliação.</p>
  <label>Planilha de fechamento<Input type="file" accept=".xlsx,.xls" disabled={api.isPending} onChange={e=>void read(e.target.files?.[0])}/></label>
  {reading?<p role="status">Lendo planilha…</p>:null}
  {source?<div className="space-y-3"><p>Modelo: {source.data.model==='summary'?'Resumo':'Detalhado'} · {source.fileName} · {source.data.model==='summary'?source.data.summaryRows.length:source.data.detailedRows.length} linha(s)</p>
   <p>Valor informado: {source.data.totals.total_invoice_value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}. Frete informado: {source.data.totals.total_freight_value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.</p>
   <fieldset disabled={api.isPending} className="grid gap-3 md:grid-cols-2"><label>Período inicial da importação<Input type="date" value={period.start} onChange={e=>setPeriod(p=>({...p,start:e.target.value}))}/></label><label>Período final da importação<Input type="date" value={period.end} onChange={e=>setPeriod(p=>({...p,end:e.target.value}))}/></label>
    <label className="md:col-span-2">Motivo da importação<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset>
   <Button disabled={api.isPending||!!api.pending||!!api.recoveryError||reason.trim().length<5||!period.start||!period.end} onClick={()=>void submit()}>Criar rascunho importado</Button>
  </div>:null}
  {api.pending?<p role="alert">Recupere o fechamento sem confirmação antes de iniciar outra importação.</p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 </CardContent></Card>;
}
