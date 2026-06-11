import { Link, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, ClipboardCheck, AlertTriangle, FileText } from 'lucide-react';
import { usePortalShipmentDetail } from '@/hooks/portal/usePortalShipmentDetail';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

export default function PortalShipmentDetail() {
  const { documentId } = useParams<{ documentId: string }>();
  const { data, isLoading, error } = usePortalShipmentDetail(documentId);

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

  return (
    <div className="space-y-4">
      <Link to="/portal/shipments"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Mercadorias</Button></Link>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">NF {doc.invoice_number || '—'}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{doc.document_type || 'NF-e'} · Emitida em {fmtDate(doc.issue_date)}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {doc.client_load_number && <Badge variant="outline" className="text-[10px]">CL: {doc.client_load_number}</Badge>}
              {doc.reference_number && <Badge variant="outline" className="text-[10px]">Ref: {doc.reference_number}</Badge>}
              {data.proofs?.length > 0 && <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 border-emerald-500/30" variant="outline"><ClipboardCheck className="h-3 w-3 mr-0.5" />Canhoto</Badge>}
              {data.occurrences?.length > 0 && <Badge className="text-[10px] bg-rose-500/15 text-rose-700 border-rose-500/30" variant="outline"><AlertTriangle className="h-3 w-3 mr-0.5" />Ocorrência</Badge>}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dados fiscais</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1.5">
            <Field label="Chave de acesso" value={doc.access_key} mono />
            <Field label="Remetente" value={doc.remitter} />
            <Field label="CNPJ Remetente" value={doc.remitter_cnpj} />
            <Field label="Destinatário" value={doc.recipient} />
            <Field label="CNPJ Destinatário" value={doc.recipient_cnpj} />
            <Field label="Cidade/UF" value={[doc.recipient_city, doc.recipient_state].filter(Boolean).join('/')} />
            <Field label="Bairro" value={doc.recipient_neighborhood} />
            <Field label="Produto" value={doc.product_summary} />
            <Field label="Volumes/Pallets" value={doc.pallet_count?.toString()} />
            <Field label="Peso (kg)" value={doc.weight_kg?.toString()} />
            {doc.value != null && <Field label="Valor da NF" value={`R$ ${Number(doc.value).toFixed(2)}`} />}
            {doc.freight_value != null && <Field label="Frete" value={`R$ ${Number(doc.freight_value).toFixed(2)}`} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Operação</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1.5">
            <Field label="Carga interna" value={load?.load_number} />
            <Field label="Status da carga" value={load?.status} />
            <Field label="Viagem" value={trip?.notes || trip?.id?.slice(0, 8)} />
            <Field label="Status da viagem" value={trip?.status} />
            <Field label="Início previsto" value={fmt(trip?.planned_start_at)} />
            <Field label="Início real" value={fmt(trip?.actual_start_at)} />
            <Field label="Parada" value={stop?.destination} />
            <Field label="Status da parada" value={stop?.status} />
            <Field label="Previsão de chegada" value={fmt(stop?.planned_arrival_at)} />
            <Field label="Chegada real" value={fmt(stop?.actual_arrival_at)} />
            <Field label="Saída real" value={fmt(stop?.actual_departure_at)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Linha do tempo</CardTitle></CardHeader>
        <CardContent>
          {(data.events?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>
          ) : (
            <ol className="space-y-2">
              {data.events.map((e: any, idx: number) => (
                <li key={e.id || idx} className="flex gap-3 text-xs">
                  <span className="text-muted-foreground tabular-nums w-32 shrink-0">{fmt(e.created_at)}</span>
                  <span className="font-medium">{e.event_type || e.type || 'Evento'}</span>
                  {e.notes && <span className="text-muted-foreground">— {e.notes}</span>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4" />Canhotos / POD</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            {(data.proofs?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">Nenhum comprovante anexado ainda.</p>
            ) : (
              data.proofs.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border border-border rounded-md p-2">
                  <div>
                    <p className="font-medium">{p.proof_type}</p>
                    <p className="text-[10px] text-muted-foreground">{fmt(p.received_at || p.created_at)} · {p.status}</p>
                    {p.receiver_name && <p className="text-[10px]">Recebido por {p.receiver_name}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Ocorrências</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2">
            {(data.occurrences?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">Sem ocorrências registradas.</p>
            ) : (
              data.occurrences.map((o: any) => (
                <div key={o.id} className="border border-border rounded-md p-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{o.event_type || o.type || 'Ocorrência'}</p>
                    <Badge variant="outline" className="text-[10px]">{o.public_status || o.status}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{fmt(o.created_at)}</p>
                  {o.description && <p className="text-xs mt-1">{o.description}</p>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
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
