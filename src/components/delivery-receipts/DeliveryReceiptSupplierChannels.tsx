import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ExternalLink,RefreshCw,ShieldAlert} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useToast} from '@/hooks/use-toast';
import {deliveryReceiptError} from '@/lib/deliveryReceipts/deliveryReceiptOperations';
import type {DeliveryReceiptSupplierGroup} from '@/lib/deliveryReceipts/deliveryReceiptSupplier';
import {getDeliveryReceiptSupplierChannels,saveDeliveryReceiptSupplierChannel} from '@/lib/deliveryReceipts/deliveryReceiptChannels';

interface Props{tenant:string;actor:string;groups:DeliveryReceiptSupplierGroup[]}
interface Draft{supplierKey:string;supplierName:string;portalOrigin:string;accountReference:string;credentialReference:string;uploadPathHint:string}
const statusLabel={draft:'Rascunho — aguardando adaptador',verified:'Verificado',suspended:'Suspenso'} as const;

export function DeliveryReceiptSupplierChannels({tenant,actor,groups}:Props){
  const {toast}=useToast(),client=useQueryClient();const [draft,setDraft]=useState<Draft|null>(null);
  const query=useQuery({queryKey:['delivery-receipt-supplier-channels',tenant,actor],retry:false,
    queryFn:({signal})=>getDeliveryReceiptSupplierChannels(tenant,actor,signal)});
  const mutation=useMutation({mutationFn:async(value:Draft)=>{const existing=query.data?.channels.find(channel=>channel.supplier_key===value.supplierKey);
    return saveDeliveryReceiptSupplierChannel(tenant,actor,{id:existing?.id,supplierKey:value.supplierKey,supplierName:value.supplierName,
      configuration:{portal_origin:value.portalOrigin,account_reference:value.accountReference.trim()||null,
        credential_reference:value.credentialReference.trim(),upload_path_hint:value.uploadPathHint.trim()||null},
      autoEnqueueRequested:true,expectedUpdatedAt:existing?.updated_at});},
  onSuccess:async()=>{setDraft(null);toast({title:'Configuração de portal salva como rascunho',description:'Nenhum canhoto foi transmitido. A ativação exige um adaptador específico verificado.'});
    await client.invalidateQueries({queryKey:['delivery-receipt-supplier-channels']});},
  onError:error=>toast({title:'Não foi possível salvar o canal',description:deliveryReceiptError(error),variant:'destructive'})});
  const generic=query.data?.adapters.find(adapter=>adapter.adapter_key==='supplier_portal_generic_v1');
  const openDraft=(supplierKey:string,supplierName:string)=>{const existing=query.data?.channels.find(channel=>channel.supplier_key===supplierKey);
    setDraft({supplierKey,supplierName,portalOrigin:existing?.safe_configuration.portal_origin??'',
      accountReference:existing?.safe_configuration.account_reference??'',credentialReference:existing?.safe_configuration.credential_reference??'',
      uploadPathHint:existing?.safe_configuration.upload_path_hint??''});};
  const canSave=!!draft&&draft.portalOrigin.startsWith('https://')&&/^[A-Z][A-Z0-9_]{5,119}$/.test(draft.credentialReference.trim());

  return <section className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Canais por fornecedor</h2>
    <p className="text-xs text-muted-foreground">E-mail permanece operacional; portais só entram na fila após verificação técnica do adaptador.</p></div>
    <Button size="sm" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw className={`mr-1 h-4 w-4 ${query.isFetching?'animate-spin':''}`}/>Atualizar</Button></div>
    <Card className="border-amber-500/40"><CardContent className="flex gap-2 p-3 text-xs"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"/>
      <p>O adaptador genérico está <strong>{generic?.is_enabled?'habilitado':'desabilitado'}</strong>. Salvar um rascunho não acessa o portal, não usa credenciais e não registra sucesso.</p></CardContent></Card>
    {query.data?<div className="grid gap-2 md:grid-cols-3"><Card><CardContent className="p-3 text-xs">Na fila: <strong>{query.data.metrics.queued}</strong></CardContent></Card>
      <Card><CardContent className="p-3 text-xs">Concluídos: <strong>{query.data.metrics.succeeded}</strong></CardContent></Card>
      <Card><CardContent className="p-3 text-xs">Falha/indisponível: <strong>{query.data.metrics.failed+query.data.metrics.unavailable}</strong></CardContent></Card></div>:null}
    {query.error?<p role="alert" className="text-sm text-destructive">{deliveryReceiptError(query.error)}</p>:null}
    <div className="flex flex-wrap gap-2">{groups.map(group=>{const channel=query.data?.channels.find(item=>item.supplier_key===group.key);return <Button key={group.key}
      size="sm" variant="outline" onClick={()=>openDraft(group.key,group.name)}><ExternalLink className="mr-1 h-4 w-4"/>{channel?'Editar':'Configurar'} portal · {group.name}</Button>;})}</div>
    {draft?<Card><CardHeader className="pb-2"><CardTitle className="text-base">Portal de {draft.supplierName}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      <div><Label htmlFor="supplier-portal-origin">Origem HTTPS do portal</Label><Input id="supplier-portal-origin" placeholder="https://portal.fornecedor.com" value={draft.portalOrigin}
        onChange={event=>setDraft(current=>current?{...current,portalOrigin:event.target.value}:current)}/></div>
      <div><Label htmlFor="supplier-portal-credential">Referência do segredo</Label><Input id="supplier-portal-credential" placeholder="SUPPLIER_PORTAL_EMPRESA_X" value={draft.credentialReference}
        onChange={event=>setDraft(current=>current?{...current,credentialReference:event.target.value.toUpperCase()}:current)}/><p className="mt-1 text-xs text-muted-foreground">Somente o nome da referência; nunca cole senha ou token.</p></div>
      <div><Label htmlFor="supplier-portal-account">Referência da conta (opcional)</Label><Input id="supplier-portal-account" value={draft.accountReference}
        onChange={event=>setDraft(current=>current?{...current,accountReference:event.target.value}:current)}/></div>
      <div><Label htmlFor="supplier-portal-path">Caminho operacional (opcional)</Label><Input id="supplier-portal-path" value={draft.uploadPathHint}
        onChange={event=>setDraft(current=>current?{...current,uploadPathHint:event.target.value}:current)}/></div>
      <div className="flex flex-wrap gap-2 md:col-span-2"><Button disabled={!canSave||mutation.isPending} onClick={()=>draft&&mutation.mutate(draft)}>Salvar rascunho seguro</Button>
        <Button variant="ghost" onClick={()=>setDraft(null)}>Cancelar</Button></div></CardContent></Card>:null}
    {query.data?.channels.length?<div className="space-y-2">{query.data.channels.map(channel=><Card key={channel.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div><p className="font-medium">{channel.supplier_name}</p><p className="text-xs text-muted-foreground">{channel.safe_configuration.portal_origin} · {channel.adapter_key}</p></div>
      <Badge variant={channel.lifecycle_status==='verified'?'secondary':'outline'}>{statusLabel[channel.lifecycle_status]}</Badge></CardContent></Card>)}</div>:null}
  </section>;
}
