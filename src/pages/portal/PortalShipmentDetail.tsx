import { Link, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, ClipboardCheck, AlertTriangle, MapPin, Download, Truck, MessageSquareWarning } from 'lucide-react';
import { usePortalShipmentDetail } from '@/hooks/portal/usePortalShipmentDetail';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalStatusBadge } from '@/components/portal/PortalStatusBadge';
import { PortalShipmentTimeline } from '@/components/portal/PortalShipmentTimeline';
import { useDownloadPortalPod } from '@/hooks/portal/usePortalPods';
import { useToast } from '@/hooks/use-toast';
import type { PublicShipmentStatus } from '@/lib/portal/portalStatus';

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const fmtBRL = (v?: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PortalShipmentDetail() {
  const { documentId } = useParams<{ documentId: string }>();
  const { data, isLoading, error } = usePortalShipmentDetail(documentId);
  const download = useDownloadPortalPod();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Link to="/portal/shipments"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button></Link>
        <PortalEmptyState title="Documento não disponível" description={(error as Error)?.message || 'Verifique seu acesso.'} />
      </div>
    );
  }

  const doc = data.document || {};
  const load = data.load;
  const trip = data.trip;
  const stop = data.stop;
  const perms = data.permissions ?? {
    can_view_financial: false,
    can_download_documents: false,
    can_view_driver_contact: false,
    can_view_vehicle_live: false,
  };
  const publicStatus: PublicShipmentStatus =
    (doc.public_status as PublicShipmentStatus) ??
    (data.proofs?.length > 0 ? 'pod_available'
      : data.occurrences?.length > 0 ? 'exception'
      : doc.status === 'delivered' ? 'pod_pending'
      : 'received');

  const firstPod = data.proofs?.find((p: any) => p.has_file);

  const handleDownloadPod = async () => {
    if (!firstPod) return;
    try {
      const url = await download.mutateAsync(firstPod.id);
      window.open(url, '_blank');
    } catch (e: any) {
      toast({ title: 'Erro ao baixar', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho executivo */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold">NF {doc.invoice_number || '—'}</h1>
                <PortalStatusBadge status={publicStatus} />
                {data.proofs?.length > 0 && (
                  <Badge variant="outline" className="text-[10px]"><ClipboardCheck className="h-3 w-3 mr-0.5" />Canhoto</Badge>
                )}
                {data.occurrences?.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />Ocorrência</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {doc.recipient || '—'}{doc.recipient_city ? ` · ${doc.recipient_city}` : ''}{doc.recipient_state ? `/${doc.recipient_state}` : ''}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3" /> Previsão: {fmt(stop?.planned_arrival_at)}
                {load?.load_number && <> · Carga {load.load_number}</>}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link to="/portal/shipments">
                <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              </Link>
              {perms.can_download_documents && firstPod && (
                <Button size="sm" variant="outline" onClick={handleDownloadPod} disabled={download.isPending}>
                  <Download className="h-4 w-4 mr-1" /> Baixar canhoto
                </Button>
              )}
              {perms.can_view_vehicle_live && trip?.id && (
                <Link to="/portal/tracking">
                  <Button size="sm" variant="outline"><Truck className="h-4 w-4 mr-1" /> Ver tracking</Button>
                </Link>
              )}
              <Link to="/portal/occurrences">
                <Button size="sm" variant="outline"><MessageSquareWarning className="h-4 w-4 mr-1" /> Abrir ocorrência</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="documents">Documentos</TabsTrigger>
          <TabsTrigger value="pods">Canhotos</TabsTrigger>
          <TabsTrigger value="occurrences">Ocorrências ({data.occurrences?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Dados da NF</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1.5">
                <Field label="Tipo" value={doc.document_type || 'NF-e'} />
                <Field label="Emissão" value={fmtDate(doc.issue_date)} />
                <Field label="Chave de acesso" value={doc.access_key} mono />
                {doc.client_load_number && <Field label="Carga do cliente" value={doc.client_load_number} />}
                {doc.reference_number && <Field label="Referência" value={doc.reference_number} />}
                <Field label="Produto" value={doc.product_summary} />
                <Field label="Volumes" value={doc.volume_count?.toString()} />
                <Field label="Pallets" value={doc.pallet_count?.toString()} />
                <Field label="Peso (kg)" value={doc.weight_kg?.toString()} />
                {perms.can_view_financial && (
                  <>
                    <Field label="Valor da NF" value={fmtBRL(doc.value)} />
                    <Field label="Frete" value={fmtBRL(doc.freight_value)} />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Partes</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1.5">
                <Field label="Remetente" value={doc.remitter} />
                <Field label="CNPJ Remetente" value={doc.remitter_cnpj} />
                <Field label="Destinatário" value={doc.recipient} />
                <Field label="CNPJ Destinatário" value={doc.recipient_cnpj} />
                <Field label="Cidade/UF" value={[doc.recipient_city, doc.recipient_state].filter(Boolean).join('/')} />
                <Field label="Bairro" value={doc.recipient_neighborhood} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="p-4">
              <PortalShipmentTimeline entries={data.timeline ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="p-4 text-xs space-y-2">
              <Field label="NF-e" value={doc.invoice_number || doc.access_key?.slice(0, 8)} />
              {load?.load_number && <Field label="Carga" value={load.load_number} />}
              <div className="pt-2">
                <PortalEmptyState
                  title="Downloads indisponíveis"
                  description="XML/PDF ainda não disponibilizados no armazenamento. Utilize a aba Canhotos para baixar o POD quando disponível."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pods">
          <Card>
            <CardContent className="p-4 text-xs space-y-2">
              {(data.proofs?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">Nenhum canhoto anexado ainda.</p>
              ) : (
                data.proofs.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between border rounded-md p-2">
                    <div>
                      <p className="font-medium capitalize">{p.proof_type}</p>
                      <p className="text-[10px] text-muted-foreground">{fmt(p.received_at)} · {p.status}</p>
                      {p.receiver_name && <p className="text-[10px]">Recebido por {p.receiver_name}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                      {perms.can_download_documents && p.has_file && (
                        <Button size="sm" variant="outline" onClick={() => download.mutateAsync(p.id).then((u) => window.open(u, '_blank'))}>
                          <Download className="h-3.5 w-3.5 mr-1" /> Baixar
                        </Button>
                      )}
                      {!p.has_file && (
                        <span className="text-[10px] text-muted-foreground">Arquivo pendente</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="occurrences">
          <Card>
            <CardContent className="p-4 text-xs space-y-2">
              {(data.occurrences?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">Sem ocorrências registradas.</p>
              ) : (
                data.occurrences.map((o: any) => (
                  <div key={o.id} className="border rounded-md p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{o.event_type || 'Ocorrência'}</p>
                      <Badge variant="outline" className="text-[10px]">{o.public_status || 'aberta'}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{fmt(o.created_at)}</p>
                    {o.description && <p>{o.description}</p>}
                    {o.client_action_required && (
                      <Badge variant="destructive" className="text-[9px]">Ação do cliente pendente</Badge>
                    )}
                    {o.client_resolution_note && (
                      <p className="text-[11px] italic border-l-2 border-primary pl-2">{o.client_resolution_note}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tracking">
          <Card>
            <CardContent className="p-4 text-xs space-y-2">
              {!perms.can_view_vehicle_live ? (
                <p className="text-muted-foreground">
                  Sem permissão para visualizar posição do veículo. Consulte os marcos públicos na aba <b>Timeline</b>.
                </p>
              ) : (
                <>
                  <Field label="Placa" value={trip?.vehicle_plate} />
                  {perms.can_view_driver_contact && (
                    <>
                      <Field label="Motorista" value={trip?.driver_name} />
                      <Field label="Contato" value={trip?.driver_phone} />
                    </>
                  )}
                  <Field label="Status da viagem" value={trip?.status} />
                  <Field label="Início real" value={fmt(trip?.actual_start_at)} />
                  <Field label="Previsão de chegada" value={fmt(stop?.planned_arrival_at)} />
                  <Field label="Chegada real" value={fmt(stop?.actual_arrival_at)} />
                  <Link to="/portal/tracking">
                    <Button size="sm" variant="outline" className="mt-2"><Truck className="h-4 w-4 mr-1" /> Abrir mapa</Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-[10px] break-all text-right' : 'text-right'}>{value || '—'}</span>
    </div>
  );
}
