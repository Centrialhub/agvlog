import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Mail, RefreshCw, Search, Truck, Upload, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  deliveryReceiptError,
  deliveryReceiptFileName,
  downloadDeliveryReceiptPdf,
  getDeliveryReceiptFilterCatalog,
  listAllDeliveryReceipts,
  listDeliveryReceipts,
  recordPhysicalDeliveryReceiptStatus,
  reviewDeliveryReceipt,
  DELIVERY_RECEIPT_PAGE_SIZE,
  type DeliveryReceiptFilters,
  type DeliveryReceiptRow,
} from '@/lib/deliveryReceipts/deliveryReceiptOperations';
import {
  getDeliveryReceiptOperations,
  getDeliveryReceiptOcrHealth,
  listDeliveryReceiptEmailHistory,
  queueAndSendDeliveryReceiptEmailBatches,
  replaceDeliveryReceipt,
  retryDeliveryReceiptEmailBatch,
  saveDeliveryReceiptEmailTemplate,
  searchDeliveryReceiptOcr,
  type DeliveryReceiptEmailHistoryBatch,
} from '@/lib/deliveryReceipts/deliveryReceiptOperationsDashboard';
import {defaultDeliveryReceiptCoverConfig,groupDeliveryReceiptsBySupplier,type DeliveryReceiptCoverConfig} from '@/lib/deliveryReceipts/deliveryReceiptSupplier';
import {DeliveryReceiptSupplierChannels} from '@/components/delivery-receipts/DeliveryReceiptSupplierChannels';
import { DeliveryReceiptQualityPolicyPanel } from '@/components/delivery-receipts/DeliveryReceiptQualityPolicyPanel';

const digitalLabels:Record<string,string>={pending_upload:'Aguardando envio',uploaded:'Enviado',pending_validation:'Aguardando validação',
  validated:'Validado',rejected:'Rejeitado',superseded:'Substituído'};
const physicalLabels:Record<string,string>={pending_return:'Papel pendente',received:'Papel recebido',missing:'Papel ausente',waived:'Dispensado'};
const emailLabels:Record<string,string>={not_sent:'Não enviado',queued:'Na fila',sent:'Enviado',delivered:'Entregue',bounced:'Devolvido',failed:'Falhou'};
const fmt=(value:string)=>format(parseISO(value),'dd/MM/yyyy HH:mm',{locale:ptBR});
interface EmailAttachment {receiptId:string;fileName:string;documents:Array<{kind:string;number?:string|null;operational_reference?:string|null}>}
interface EmailComposer {supplierKey:string;supplier:string;attachments:EmailAttachment[];recipients:string;subject:string;body:string;cover:DeliveryReceiptCoverConfig}
const parseRecipients=(value:string)=>[...new Set(value.split(/[;,\n]/).map(item=>item.trim().toLowerCase()).filter(Boolean))];
const rowAttachment=(row:DeliveryReceiptRow):EmailAttachment=>({receiptId:row.id,fileName:deliveryReceiptFileName(row),documents:row.documents});
const historyAttachments=(batch:DeliveryReceiptEmailHistoryBatch):EmailAttachment[]=>batch.receipt_ids.map(receiptId=>{
  const item=batch.items.find(value=>value.receipt_id===receiptId);return {receiptId,fileName:item?.file_name??`Canhoto ${receiptId.slice(0,8)}`,
    documents:item?.documents.map(document=>({kind:document.kind,number:document.number}))??[]};});
const queueLabels=[
  ['awaiting_sync','Aguardando sincronização'],['awaiting_validation','Aguardando validação'],['rejected','Rejeitados'],['validated','Validados'],
  ['physical_pending','Papel físico pendente'],['ready_to_send','Prontos para envio'],['sent','Enviados'],['send_failures','Falhas de envio'],
] as const;

export default function DeliveryReceipts(){
  const {currentTenant,currentRole}=useTenant();const {user}=useAuth();const {toast}=useToast();const client=useQueryClient();
  const [filters,setFilters]=useState<DeliveryReceiptFilters>({});
  const [page,setPage]=useState(1);
  const [historyPage,setHistoryPage]=useState(1);const [historySearch,setHistorySearch]=useState('');const [historyStatus,setHistoryStatus]=useState('');
  const [rejecting,setRejecting]=useState<DeliveryReceiptRow|null>(null);const [reason,setReason]=useState('');
  const [selected,setSelected]=useState<string[]>([]);const [email,setEmail]=useState<EmailComposer|null>(null);
  const [replacing,setReplacing]=useState<DeliveryReceiptRow|null>(null);const [replacementFile,setReplacementFile]=useState<File|null>(null);
  const [replacementReason,setReplacementReason]=useState('');
  const [physicalReview,setPhysicalReview]=useState<{row:DeliveryReceiptRow;status:'missing'|'waived'}|null>(null);
  const [physicalReason,setPhysicalReason]=useState('');
  const tenant=currentTenant?.id,actor=user?.id;
  const query=useQuery({queryKey:['delivery-receipts',tenant,actor,'page',filters,page],enabled:!!tenant&&!!actor,retry:false,
    queryFn:({signal})=>listDeliveryReceipts(tenant!,actor!,filters,{limit:DELIVERY_RECEIPT_PAGE_SIZE,offset:(page-1)*DELIVERY_RECEIPT_PAGE_SIZE},signal)});
  const allFiltered=useQuery({queryKey:['delivery-receipts',tenant,actor,'all-filtered',filters],enabled:!!tenant&&!!actor,retry:false,
    queryFn:({signal})=>listAllDeliveryReceipts(tenant!,actor!,filters,signal)});
  const catalog=useQuery({queryKey:['delivery-receipts',tenant,actor,'filter-catalog'],enabled:!!tenant&&!!actor,retry:false,staleTime:60_000,
    queryFn:({signal})=>getDeliveryReceiptFilterCatalog(tenant!,actor!,signal)});
  const operations=useQuery({queryKey:['delivery-receipt-operations',tenant,actor],enabled:!!tenant&&!!actor,retry:false,
    queryFn:({signal})=>getDeliveryReceiptOperations(tenant!,actor!,signal)});
  const history=useQuery({queryKey:['delivery-receipt-email-history',tenant,actor,historySearch,historyStatus,historyPage],enabled:!!tenant&&!!actor,retry:false,
    queryFn:({signal})=>listDeliveryReceiptEmailHistory(tenant!,actor!,{search:historySearch,status:historyStatus,limit:25,offset:(historyPage-1)*25},signal)});
  const ocrHealth=useQuery({queryKey:['delivery-receipt-ocr-health',tenant,actor],enabled:!!tenant&&!!actor,retry:false,
    queryFn:({signal})=>getDeliveryReceiptOcrHealth(tenant!,actor!,signal)});
  const ocrSearch=useQuery({queryKey:['delivery-receipt-ocr-search',tenant,actor,filters.search],
    enabled:!!tenant&&!!actor&&(filters.search?.trim().length??0)>=2,retry:false,
    queryFn:({signal})=>searchDeliveryReceiptOcr(tenant!,actor!,filters.search!,signal)});
  const mutation=useMutation({mutationFn:async(action:{type:'validate'|'reject'|'physical';row:DeliveryReceiptRow;reason?:string;physicalStatus?:'received'|'missing'|'waived'})=>{
    if(!tenant||!actor)throw new Error('Empresa ou usuário não selecionado.');
    if(action.type==='physical')return recordPhysicalDeliveryReceiptStatus(tenant,actor,action.row,action.physicalStatus??'received',action.reason);
    return reviewDeliveryReceipt(tenant,action.row,action.type==='validate'?'validated':'rejected',action.reason);
  },onSuccess:async()=>{setRejecting(null);setReason('');setPhysicalReview(null);setPhysicalReason('');toast({title:'Canhoto atualizado'});
    await Promise.all([client.invalidateQueries({queryKey:['delivery-receipts']}),client.invalidateQueries({queryKey:['delivery-receipt-operations']})]);},
  onError:error=>toast({title:'Não foi possível atualizar',description:deliveryReceiptError(error),variant:'destructive'})});
  const downloadMutation=useMutation({mutationFn:(row:DeliveryReceiptRow)=>downloadDeliveryReceiptPdf(tenant!,actor!,row),
    onSuccess:async()=>{toast({title:'PDF do canhoto baixado'});await client.invalidateQueries({queryKey:['delivery-receipts']});},
    onError:error=>toast({title:'Não foi possível baixar o PDF',description:deliveryReceiptError(error),variant:'destructive'})});
  const emailMutation=useMutation({mutationFn:async(draft:EmailComposer)=>{
    if(!tenant||!actor)throw new Error('Empresa ou usuário não selecionado.');
    const recipients=parseRecipients(draft.recipients);
    return queueAndSendDeliveryReceiptEmailBatches(tenant,actor,{supplierKey:draft.supplierKey,supplier:draft.supplier,receiptIds:draft.attachments.map(item=>item.receiptId),recipients,
      subject:draft.subject.trim(),body:draft.body.trim(),cover:draft.cover});
  },onSuccess:async result=>{setEmail(null);setSelected([]);toast({title:`${result.receiptCount} canhoto(s) enviados em ${result.batchCount} lote(s)`});
    await Promise.all([client.invalidateQueries({queryKey:['delivery-receipts']}),client.invalidateQueries({queryKey:['delivery-receipt-operations']}),
      client.invalidateQueries({queryKey:['delivery-receipt-email-history']})]);},
  onError:error=>toast({title:'Não foi possível concluir todos os lotes',description:deliveryReceiptError(error),variant:'destructive'})});
  const templateMutation=useMutation({mutationFn:async(draft:EmailComposer)=>{
    if(!tenant||!actor)throw new Error('Empresa ou usuário não selecionado.');const existing=operations.data?.templates.find(item=>item.supplier_key===draft.supplierKey||(!item.supplier_key&&item.supplier_name===draft.supplier));
    return saveDeliveryReceiptEmailTemplate(tenant,actor,{id:existing?.id,supplierKey:draft.supplierKey,supplier:draft.supplier,recipients:parseRecipients(draft.recipients),
      subject:draft.subject.trim(),body:draft.body.trim(),cover:draft.cover,expectedUpdatedAt:existing?.updated_at});
  },onSuccess:async()=>{toast({title:'Modelo do fornecedor salvo'});await client.invalidateQueries({queryKey:['delivery-receipt-operations']});},
  onError:error=>toast({title:'Não foi possível salvar o modelo',description:deliveryReceiptError(error),variant:'destructive'})});
  const replacementMutation=useMutation({mutationFn:async()=>{if(!tenant||!actor||!replacing||!replacementFile)throw new Error('Selecione o arquivo substituto.');
    return replaceDeliveryReceipt(tenant,actor,replacing,replacementFile,replacementReason);},onSuccess:async()=>{setReplacing(null);setReplacementFile(null);setReplacementReason('');
      toast({title:'Substituição registrada para nova validação'});await Promise.all([client.invalidateQueries({queryKey:['delivery-receipts']}),client.invalidateQueries({queryKey:['delivery-receipt-operations']})]);},
    onError:error=>toast({title:'Não foi possível substituir o canhoto',description:deliveryReceiptError(error),variant:'destructive'})});
  const retryMutation=useMutation({mutationFn:(batchId:string)=>retryDeliveryReceiptEmailBatch(tenant!,batchId),onSuccess:async()=>{
    toast({title:'Lote reenviado com confirmação'});await Promise.all([client.invalidateQueries({queryKey:['delivery-receipt-operations']}),
      client.invalidateQueries({queryKey:['delivery-receipt-email-history']})]);},
    onError:error=>toast({title:'Reenvio não confirmado',description:deliveryReceiptError(error),variant:'destructive'})});
  const groups=useMemo(()=>groupDeliveryReceiptsBySupplier(query.data?.rows??[]),[query.data?.rows]);
  const allGroups=useMemo(()=>groupDeliveryReceiptsBySupplier(allFiltered.data??[]),[allFiltered.data]);
  const emailRecipients=parseRecipients(email?.recipients??'');
  const canWaivePhysical=currentRole==='owner'||currentRole==='admin';
  const totalPages=Math.max(1,Math.ceil((query.data?.total??0)/(query.data?.limit??DELIVERY_RECEIPT_PAGE_SIZE)));
  const historyTotalPages=Math.max(1,Math.ceil((history.data?.total??0)/(history.data?.limit??25)));
  useEffect(()=>{if(query.data&&page>totalPages)setPage(totalPages);},[page,query.data,totalPages]);
  useEffect(()=>{setPage(1);setSelected([]);setEmail(null);},[filters]);
  useEffect(()=>{if(history.data&&historyPage>historyTotalPages)setHistoryPage(historyTotalPages);},[history.data,historyPage,historyTotalPages]);
  const openEmail=(key:string,supplier:string,attachments:EmailAttachment[],seed?:Partial<Pick<EmailComposer,'recipients'|'subject'|'body'>>)=>{const template=operations.data?.templates.find(item=>item.is_active&&(item.supplier_key===key||(!item.supplier_key&&item.supplier_name===supplier)));
    setEmail({supplierKey:key,supplier,attachments,recipients:seed?.recipients??template?.recipients.join('; ')??'',subject:seed?.subject??template?.subject_template??`Comprovantes de entrega — ${supplier}`,
      body:seed?.body??template?.body_template??`Olá,\n\nSeguem anexos os comprovantes de entrega referentes aos documentos listados abaixo.\n\nAtenciosamente.`,
      cover:template?.cover_config??defaultDeliveryReceiptCoverConfig});};

  return <div className="space-y-4">
    <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><FileCheck2 className="h-6 w-6 text-primary"/>Canhotos</h1>
      <p className="text-sm text-muted-foreground">Um comprovante por entrega, organizado por fornecedor e com custódia digital e física separadas.</p></div>
    {tenant&&actor?<DeliveryReceiptQualityPolicyPanel tenantId={tenant} actorId={actor}/>:null}
    {catalog.data?<section aria-labelledby="receipt-workflow-queues" className="space-y-2"><h2 id="receipt-workflow-queues" className="text-sm font-semibold">Filas operacionais</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{queueLabels.map(([key,label])=><Card key={key}><CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p><strong>{catalog.data.queues[key]}</strong>
      </CardContent></Card>)}</div></section>:null}
    {ocrHealth.data?<Card><CardContent className="flex flex-wrap gap-4 p-3 text-xs"><span>OCR na fila: <strong>{ocrHealth.data.queued}</strong></span>
      <span>Processando: <strong>{ocrHealth.data.processing}</strong></span><span>Concluído: <strong>{ocrHealth.data.completed}</strong></span>
      <span>Indisponível: <strong>{ocrHealth.data.unavailable}</strong></span><span>Baixa confiança: <strong>{ocrHealth.data.low_confidence}</strong></span></CardContent></Card>:null}
    {operations.error?<p role="alert">A observabilidade operacional não pôde ser carregada: {deliveryReceiptError(operations.error)}</p>:null}
    {catalog.error?<p role="alert">As filas e opções completas de filtro não puderam ser carregadas: {deliveryReceiptError(catalog.error)}</p>:null}
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-6">
      <div className="relative md:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/>
        <Input aria-label="Buscar canhotos" className="pl-9" placeholder="NF, NFS, CT-e, chave ou fornecedor" value={filters.search??''}
          onChange={event=>setFilters(current=>({...current,search:event.target.value||undefined}))}/></div>
      <select aria-label="Status digital" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.digital_status??''}
        onChange={event=>setFilters(current=>({...current,digital_status:event.target.value||undefined}))}>
        <option value="">Todos os digitais</option>{Object.entries(digitalLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Status físico" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.physical_status??''}
        onChange={event=>setFilters(current=>({...current,physical_status:event.target.value||undefined}))}>
        <option value="">Todos os físicos</option>{Object.entries(physicalLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Status do e-mail" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.email_status??''}
        onChange={event=>setFilters(current=>({...current,email_status:event.target.value||undefined}))}>
        <option value="">Todos os e-mails</option>{Object.entries(emailLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Tipo de documento" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.document_kind??''}
        onChange={event=>setFilters(current=>({...current,document_kind:event.target.value||undefined}))}>
        <option value="">Todos os documentos</option><option value="nfe">NF-e</option><option value="nfse">NFS-e</option><option value="cte">CT-e</option><option value="other_fiscal">Outro fiscal</option><option value="operational_reference">Referência operacional</option></select>
      <select aria-label="Modo de captura" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.scan_mode??''}
        onChange={event=>setFilters(current=>({...current,scan_mode:event.target.value||undefined}))}>
        <option value="">Todos os modos</option><option value="document_scan">Scan</option><option value="native_document_scan">Scan nativo</option><option value="manual_crop">Recorte manual</option><option value="legacy_photo">Foto legada</option><option value="operator_replacement">Substituição operacional</option></select>
      <select aria-label="Disponibilidade do PDF" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.has_pdf===undefined?'':String(filters.has_pdf)}
        onChange={event=>setFilters(current=>({...current,has_pdf:event.target.value===''?undefined:event.target.value==='true'}))}>
        <option value="">Com ou sem PDF</option><option value="true">PDF pronto</option><option value="false">PDF pendente</option></select>
      <select aria-label="Motorista" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.driver_id??''}
        onChange={event=>setFilters(current=>({...current,driver_id:event.target.value||undefined}))}><option value="">Todos os motoristas</option>
        {(catalog.data?.drivers??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Veículo" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.vehicle_id??''}
        onChange={event=>setFilters(current=>({...current,vehicle_id:event.target.value||undefined}))}><option value="">Todos os veículos</option>
        {(catalog.data?.vehicles??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Fornecedor" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.supplier_id??''}
        onChange={event=>setFilters(current=>({...current,supplier_id:event.target.value||undefined}))}><option value="">Todos os fornecedores</option>
        {(catalog.data?.suppliers??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Viagem" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.trip_id??''}
        onChange={event=>setFilters(current=>({...current,trip_id:event.target.value||undefined}))}><option value="">Todas as viagens</option>
        {(catalog.data?.trips??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Carga" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.load_id??''}
        onChange={event=>setFilters(current=>({...current,load_id:event.target.value||undefined}))}><option value="">Todas as cargas</option>
        {(catalog.data?.loads??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Cliente" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.client_id??''}
        onChange={event=>setFilters(current=>({...current,client_id:event.target.value||undefined}))}><option value="">Todos os clientes</option>
        {(catalog.data?.clients??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="Cidade de destino" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.destination_city??''}
        onChange={event=>setFilters(current=>({...current,destination_city:event.target.value||undefined}))}><option value="">Todas as cidades</option>
        {(catalog.data?.cities??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label="UF de destino" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.destination_state??''}
        onChange={event=>setFilters(current=>({...current,destination_state:event.target.value||undefined}))}><option value="">Todas as UFs</option>
        {(catalog.data?.states??[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <Input aria-label="Recebedor" placeholder="Nome do recebedor" value={filters.receiver??''}
        onChange={event=>setFilters(current=>({...current,receiver:event.target.value||undefined}))}/>
      <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching?'animate-spin':''}`}/>Atualizar</Button>
      <div><Label htmlFor="receipt-date-from" className="text-xs">Entrega de</Label><Input id="receipt-date-from" type="date" value={filters.date_from??''}
        onChange={event=>setFilters(current=>({...current,date_from:event.target.value||undefined}))}/></div>
      <div><Label htmlFor="receipt-date-to" className="text-xs">Entrega até</Label><Input id="receipt-date-to" type="date" value={filters.date_to??''}
        onChange={event=>setFilters(current=>({...current,date_to:event.target.value||undefined}))}/></div>
      <Button variant="ghost" onClick={()=>setFilters({})}>Limpar filtros</Button>
    </CardContent></Card>
    {ocrSearch.data?.length?<Card><CardHeader className="pb-2"><CardTitle className="text-sm">Correspondências encontradas no texto OCR</CardTitle></CardHeader>
      <CardContent className="space-y-2">{ocrSearch.data.map(match=><div key={match.receipt_id} className="rounded border p-2 text-xs">
        <p><strong>Confiança:</strong> {match.confidence===null?'não informada':`${Math.round(match.confidence*100)}%`}</p><p className="line-clamp-2">{match.text}</p></div>)}</CardContent></Card>:null}
    {query.isPending?<p role="status">Carregando canhotos…</p>:null}
    {query.isError?<Card><CardContent className="space-y-3 p-5" role="alert"><p>{deliveryReceiptError(query.error)}</p>
      <Button variant="outline" onClick={()=>void query.refetch()}>Tentar novamente</Button></CardContent></Card>:null}
    {!query.isPending&&!query.isError&&groups.length===0?<Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhum canhoto encontrado.</CardContent></Card>:null}
    {allFiltered.error?<p role="alert">A seleção completa entre páginas não pôde ser carregada: {deliveryReceiptError(allFiltered.error)}</p>:null}
    {groups.map(({key,name:supplier,rows,documentKinds})=>{const scopedRows=allGroups.find(group=>group.key===key)?.rows??[];
      const eligible=scopedRows.filter(row=>row.digital_status==='validated'&&row.has_pdf);
      const selectedRows=eligible.filter(row=>selected.includes(row.id));const bulkSelection=eligible;
      return <section key={key} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{supplier}</h2><Badge variant="secondary">{rows.length}</Badge>
        <span className="text-xs text-muted-foreground">{documentKinds.map(kind=>kind.toUpperCase()).join(' · ')}</span></div>
        <Button size="sm" variant="outline" disabled={!selectedRows.length||emailMutation.isPending||allFiltered.isFetching} onClick={()=>openEmail(key,supplier,selectedRows.map(rowAttachment))}>
          <Mail className="mr-1 h-4 w-4"/>Preparar e-mail ({selectedRows.length})</Button></div>
      {eligible.length>0?<label className="flex w-fit items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" disabled={allFiltered.isFetching}
        checked={bulkSelection.every(row=>selected.includes(row.id))} onChange={event=>{const checked=event.target.checked;setSelected(current=>checked?
          [...new Set([...current,...bulkSelection.map(row=>row.id)])]:current.filter(id=>!eligible.some(row=>row.id===id)));}}/>
        Selecionar todos os {eligible.length} PDFs validados deste fornecedor no filtro atual</label>:null}
      {rows.map(row=><Card key={row.id}><CardHeader className="pb-2"><div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2"><input aria-label={`Selecionar canhoto da entrega ${fmt(row.delivered_at)}`} className="mt-1" type="checkbox"
          disabled={row.digital_status!=='validated'||!row.has_pdf} checked={selected.includes(row.id)} onChange={event=>{const checked=event.target.checked;setSelected(current=>checked?
            [...current,row.id]:current.filter(id=>id!==row.id));}}/><div><CardTitle className="text-base">Entrega em {fmt(row.delivered_at)}</CardTitle><p className="text-xs text-muted-foreground">{row.destination||'Destino não informado'}</p></div></div>
        <div className="flex gap-2"><Badge variant="outline">{digitalLabels[row.digital_status]??row.digital_status}</Badge>
          <Badge variant="outline">{physicalLabels[row.physical_status]??row.physical_status}</Badge><Badge variant="outline">{emailLabels[row.email_status]??row.email_status}</Badge></div></div></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm md:grid-cols-3"><p><Truck className="mr-1 inline h-4 w-4"/>{row.driver?.name||'Motorista não informado'}</p>
            <p>Veículo: {row.vehicle?.plate||'—'}</p><p>Recebedor: {row.receiver_name||'—'}</p></div>
          <div className="flex flex-wrap gap-1">{row.documents.map(document=><Badge key={document.id} variant="secondary">
            {document.kind.toUpperCase()} {document.number||document.operational_reference||'sem número'}</Badge>)}</div>
          <p className="text-xs text-muted-foreground">Arquivo individual: {deliveryReceiptFileName(row)}</p>
          {row.rejection_reason?<p className="text-xs text-destructive"><AlertTriangle className="mr-1 inline h-3 w-3"/>Rejeição: {row.rejection_reason}</p>:null}
          {row.previous_receipt_id?<p className="text-xs text-muted-foreground">Versão substituta {row.version??'—'} · anterior {row.previous_receipt_id.slice(0,8)}</p>:null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={(!row.has_processed&&!row.has_pdf)||downloadMutation.isPending}
              onClick={()=>downloadMutation.mutate(row)}><Download className="mr-1 h-4 w-4"/>Baixar PDF</Button>
            {row.digital_status!=='validated'?<Button size="sm" disabled={mutation.isPending} onClick={()=>mutation.mutate({type:'validate',row})}>
              <CheckCircle2 className="mr-1 h-4 w-4"/>Validar digital</Button>:null}
            {row.digital_status!=='rejected'?<Button size="sm" variant="outline" disabled={mutation.isPending} onClick={()=>{setRejecting(row);setReason('');}}>
              <XCircle className="mr-1 h-4 w-4"/>Rejeitar</Button>:null}
            {row.physical_status!=='received'?<Button size="sm" variant="outline" disabled={mutation.isPending}
              onClick={()=>mutation.mutate({type:'physical',row,physicalStatus:'received'})}>Confirmar papel na volta</Button>:null}
            {row.physical_status==='pending_return'?<Button size="sm" variant="outline" disabled={mutation.isPending}
              onClick={()=>{setPhysicalReview({row,status:'missing'});setPhysicalReason('');}}>Marcar papel ausente</Button>:null}
            {canWaivePhysical&&['pending_return','missing'].includes(row.physical_status)?<Button size="sm" variant="outline" disabled={mutation.isPending}
              onClick={()=>{setPhysicalReview({row,status:'waived'});setPhysicalReason('');}}>Dispensar devolução</Button>:null}
            <Button size="sm" variant="outline" disabled={replacementMutation.isPending} onClick={()=>{setReplacing(row);setReplacementFile(null);setReplacementReason('');}}>
              <Upload className="mr-1 h-4 w-4"/>Substituir arquivo</Button>
          </div>
          {rejecting?.id===row.id?<div className="space-y-2 rounded-md border p-3"><Label htmlFor={`receipt-reason-${row.id}`}>Motivo da rejeição</Label>
            <Textarea id={`receipt-reason-${row.id}`} value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000}/>
            <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={reason.trim().length<3||mutation.isPending}
              onClick={()=>mutation.mutate({type:'reject',row,reason})}>Confirmar rejeição</Button>
              <Button size="sm" variant="ghost" onClick={()=>setRejecting(null)}>Cancelar</Button></div></div>:null}
          {physicalReview?.row.id===row.id?<div className="space-y-2 rounded-md border border-amber-500/40 p-3">
            <Label htmlFor={`receipt-physical-reason-${row.id}`}>{physicalReview.status==='missing'?'Motivo do papel ausente':'Justificativa da dispensa administrativa'}</Label>
            <Textarea id={`receipt-physical-reason-${row.id}`} value={physicalReason} onChange={event=>setPhysicalReason(event.target.value)} maxLength={1000}/>
            <p className="text-xs text-muted-foreground">{physicalReview.status==='missing'
              ?'O registro abrirá uma ocorrência operacional vinculada à entrega.'
              :'A dispensa fica registrada na trilha de auditoria e não substitui o canhoto digital.'}</p>
            <div className="flex gap-2"><Button size="sm" variant={physicalReview.status==='missing'?'destructive':'default'}
              disabled={physicalReason.trim().length<5||mutation.isPending}
              onClick={()=>mutation.mutate({type:'physical',row,physicalStatus:physicalReview.status,reason:physicalReason})}>
              {physicalReview.status==='missing'?'Confirmar ausência':'Confirmar dispensa'}</Button>
              <Button size="sm" variant="ghost" onClick={()=>setPhysicalReview(null)}>Cancelar</Button></div></div>:null}
          {replacing?.id===row.id?<div className="space-y-2 rounded-md border p-3"><Label htmlFor={`receipt-replacement-${row.id}`}>Novo scan ou PDF</Label>
            <Input id={`receipt-replacement-${row.id}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              onChange={event=>setReplacementFile(event.target.files?.[0]??null)}/><Label htmlFor={`receipt-replacement-reason-${row.id}`}>Motivo da substituição</Label>
            <Textarea id={`receipt-replacement-reason-${row.id}`} value={replacementReason} onChange={event=>setReplacementReason(event.target.value)} maxLength={1000}/>
            <div className="flex gap-2"><Button size="sm" disabled={!replacementFile||replacementReason.trim().length<5||replacementMutation.isPending}
              onClick={()=>replacementMutation.mutate()}>Registrar substituição</Button><Button size="sm" variant="ghost" onClick={()=>setReplacing(null)}>Cancelar</Button></div></div>:null}
        </CardContent></Card>)}
    </section>})}
    {email?<Card className="border-primary/40"><CardHeader className="pb-2"><CardTitle className="text-base">Prévia do envio — {email.supplier}</CardTitle></CardHeader>
      <CardContent className="space-y-3"><div><Label htmlFor="receipt-email-to">Destinatários</Label><Input id="receipt-email-to"
        placeholder="financeiro@fornecedor.com; outro@fornecedor.com" value={email.recipients} onChange={event=>setEmail(current=>current?{...current,recipients:event.target.value}:current)}/>
        <p className={`mt-1 text-xs ${emailRecipients.length>10?'text-destructive':'text-muted-foreground'}`}>{emailRecipients.length}/10 destinatários</p></div>
        <div><Label htmlFor="receipt-email-subject">Assunto</Label><Input id="receipt-email-subject" value={email.subject}
          onChange={event=>setEmail(current=>current?{...current,subject:event.target.value}:current)} maxLength={200}/></div>
        <div><Label htmlFor="receipt-email-body">Mensagem</Label><Textarea id="receipt-email-body" value={email.body}
          onChange={event=>setEmail(current=>current?{...current,body:event.target.value}:current)} maxLength={5000}/></div>
        <div className="space-y-2 rounded-md border p-3"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={email.cover.enabled}
          onChange={event=>setEmail(current=>current?{...current,cover:{...current.cover,enabled:event.target.checked}}:current)}/>Incluir capa configurável nos PDFs enviados</label>
          {email.cover.enabled?<><div><Label htmlFor="receipt-cover-title">Título da capa</Label><Input id="receipt-cover-title" value={email.cover.title} maxLength={120}
            onChange={event=>setEmail(current=>current?{...current,cover:{...current.cover,title:event.target.value}}:current)}/></div>
            <div><Label htmlFor="receipt-cover-subtitle">Subtítulo</Label><Input id="receipt-cover-subtitle" value={email.cover.subtitle??''} maxLength={240}
              onChange={event=>setEmail(current=>current?{...current,cover:{...current.cover,subtitle:event.target.value||null}}:current)}/></div>
            <div><Label htmlFor="receipt-cover-footer">Rodapé</Label><Textarea id="receipt-cover-footer" value={email.cover.footer??''} maxLength={500}
              onChange={event=>setEmail(current=>current?{...current,cover:{...current.cover,footer:event.target.value||null}}:current)}/></div></>:null}</div>
        <div className="rounded-md bg-muted p-3 text-xs"><p className="font-medium">Anexos ({email.attachments.length} PDFs individuais em pelo menos {Math.ceil(email.attachments.length/5)} lote(s))</p>
          {email.attachments.map(item=><p key={item.receiptId}>{item.fileName} — {item.documents.map(document=>`${document.kind.toUpperCase()} ${document.number||document.operational_reference||'sem número'}`).join(', ')}</p>)}</div>
        <div className="flex flex-wrap gap-2"><Button disabled={emailMutation.isPending||emailRecipients.length<1||emailRecipients.length>10||email.subject.trim().length<3||email.body.trim().length<3}
          onClick={()=>emailMutation.mutate(email)}><Mail className="mr-1 h-4 w-4"/>Enviar lotes</Button>
          <Button variant="outline" disabled={templateMutation.isPending||emailRecipients.length<1||emailRecipients.length>10||email.subject.trim().length<3||email.body.trim().length<3}
            onClick={()=>templateMutation.mutate(email)}>Salvar modelo do fornecedor</Button><Button variant="ghost" onClick={()=>setEmail(null)}>Cancelar</Button></div>
      </CardContent></Card>:null}
    {query.data&&query.data.total>0?<nav aria-label="Paginação de canhotos" className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
      <p>Exibindo {query.data.rows.length?query.data.offset+1:0}–{Math.min(query.data.offset+query.data.rows.length,query.data.total)} de {query.data.total} canhotos</p>
      <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page<=1||query.isFetching} onClick={()=>setPage(current=>Math.max(1,current-1))}>Anterior</Button>
        <span>Página {page} de {totalPages}</span><Button size="sm" variant="outline" disabled={page>=totalPages||query.isFetching}
          onClick={()=>setPage(current=>Math.min(totalPages,current+1))}>Próxima</Button></div>
    </nav>:null}
    <section className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Monitor de e-mails</h2>
      <Button size="sm" variant="outline" disabled={history.isFetching} onClick={()=>void history.refetch()}>Atualizar monitor</Button></div>
      <div className="grid gap-2 md:grid-cols-[1fr_220px]"><Input aria-label="Pesquisar histórico de lotes" placeholder="Fornecedor, NF, NFS, CT-e, destinatário ou lote" value={historySearch}
        onChange={event=>{setHistorySearch(event.target.value);setHistoryPage(1);}}/><select aria-label="Filtrar status dos lotes" className="h-10 rounded-md border bg-background px-3 text-sm"
          value={historyStatus} onChange={event=>{setHistoryStatus(event.target.value);setHistoryPage(1);}}><option value="">Todos os status</option>
          {['queued','sending','sent','delivered','bounced','failed'].map(status=><option key={status} value={status}>{emailLabels[status]??status}</option>)}</select></div>
      {history.isPending?<p role="status" className="text-sm text-muted-foreground">Carregando histórico de lotes…</p>:null}
      {history.error?<p role="alert" className="text-sm text-destructive">O histórico de lotes não pôde ser carregado: {deliveryReceiptError(history.error)}</p>:null}
      {history.data?.rows.length===0?<p className="text-sm text-muted-foreground">Nenhum lote encontrado.</p>:history.data?.rows.map(batch=><Card key={batch.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
        <div><p className="font-medium">{batch.supplier_name} · {batch.receipt_ids.length} PDF(s)</p><p className="text-xs text-muted-foreground">{fmt(batch.created_at)} · tentativa {batch.attempt_count} · {emailLabels[batch.status]??batch.status}</p>
          {batch.last_error?<p className="text-xs text-destructive">{batch.last_error}</p>:null}</div>
        {batch.status==='failed'?<Button size="sm" variant="outline" disabled={retryMutation.isPending||!!batch.retry_after_at&&Date.parse(batch.retry_after_at)>Date.now()}
          onClick={()=>retryMutation.mutate(batch.id)}>Tentar novamente</Button>:null}
        {batch.status==='bounced'?<Button size="sm" variant="outline" onClick={()=>openEmail(batch.supplier_key,batch.supplier_name,historyAttachments(batch),
          {recipients:batch.recipients.join('; '),subject:batch.subject,body:batch.body_text})}>Preparar novo envio</Button>:null}
      </CardContent></Card>)}
      {history.data&&history.data.total>0?<nav aria-label="Paginação do histórico de lotes" className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <p>Exibindo {history.data.rows.length?history.data.offset+1:0}–{Math.min(history.data.offset+history.data.rows.length,history.data.total)} de {history.data.total} lotes</p>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={historyPage<=1||history.isFetching} onClick={()=>setHistoryPage(current=>Math.max(1,current-1))}>Anterior</Button>
          <span>Página {historyPage} de {historyTotalPages}</span><Button size="sm" variant="outline" disabled={historyPage>=historyTotalPages||history.isFetching}
            onClick={()=>setHistoryPage(current=>Math.min(historyTotalPages,current+1))}>Próxima</Button></div></nav>:null}
    </section>
    {operations.data?.templates.length?<section className="space-y-2"><h2 className="font-semibold">Modelos por fornecedor</h2>
      <div className="flex flex-wrap gap-2">{operations.data.templates.map(template=><Badge key={template.id} variant={template.is_active?'secondary':'outline'}>
        {template.supplier_name} · v{template.template_version} · {template.recipients.length} destinatário(s){template.is_active?'':' · inativo'}</Badge>)}</div></section>:null}
    {tenant&&actor?<DeliveryReceiptSupplierChannels tenant={tenant} actor={actor} groups={groups}/>:null}
  </div>;
}
