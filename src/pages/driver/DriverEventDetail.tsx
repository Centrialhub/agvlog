import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  User,
  FileText,
  Camera,
  PenLine,
  Package,
  Hash,
} from 'lucide-react';
import DemoBanner from '@/components/driver/DemoBanner';
import { DEMO_EVENTS_INITIAL } from './DriverEvents';
import { canUseDriverDemo } from '@/lib/driver/demoMode';
import { useCurrentDriver } from '@/hooks/useCurrentDriver';

const FINAL_EVENT_TYPES = new Set([
  'delivered', 'refused', 'returned', 'partial_delivery', 'damaged', 'missing_goods',
  'delivery_completed', 'delivery_failed',
]);

export default function DriverEventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: driver } = useCurrentDriver();

  const { data: realRow } = useQuery({
    queryKey: ['driver_event_detail', id, driver?.id],
    queryFn: async () => {
      if (!id || !driver?.id) return null;
      const { data, error } = await supabase
        .from('operational_events')
        .select('*')
        .eq('id', id)
        .eq('driver_id', driver.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!driver?.id,
  });

  const isDemo = !driver && canUseDriverDemo;
  const event = isDemo
    ? DEMO_EVENTS_INITIAL.find((e) => e.id === id)
    : realRow
      ? (() => {
          const details = realRow.report_details || {};
          const type: 'finalizador' | 'informativo' = FINAL_EVENT_TYPES.has(realRow.event_type) ? 'finalizador' : 'informativo';
          return {
            id: realRow.id,
            type,
            code: (realRow.event_type || '').toUpperCase().slice(0, 4),
            label: details.label || realRow.event_type || 'Evento',
            stopName: details.stop_name || details.client_name || '—',
            invoice: details.invoice || details.nf,
            receiver: details.receiver_name,
            document: details.receiver_document,
            observation: realRow.description,
            occurredAt: realRow.created_at,
            hasPhoto: !!details.has_photo,
            hasSignature: !!details.has_signature,
          };
        })()
      : undefined;

  if (!event) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="pl-0">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Evento não encontrado</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFinal = event.type === 'finalizador';
  const Icon = isFinal ? CheckCircle2 : AlertTriangle;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="pl-0 -ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Eventos
      </Button>

      {isDemo && (
        <DemoBanner
          message="Modo demonstração — dados fictícios."
          onReset={() => { /* no-op */ }}
        />
      )}

      {/* Header card */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${
                isFinal ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
              }`}
            >
              <Icon className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold">{event.label}</h2>
                <Badge variant="outline" className="text-[10px]">
                  {event.code}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                Evento {event.type}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stop / NF */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
                Cliente / Parada
              </p>
              <p className="text-sm font-medium">{event.stopName}</p>
            </div>
          </div>
          {event.invoice && (
            <>
              <Separator />
              <div className="flex items-start gap-2">
                <Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
                    Nota fiscal
                  </p>
                  <p className="text-sm font-medium">NF {event.invoice}</p>
                </div>
              </div>
            </>
          )}
          <Separator />
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
                Lançado em
              </p>
              <p className="text-sm font-medium">
                {new Date(event.occurredAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recipient */}
      {(event.receiver || event.document) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
              Recebedor
            </p>
            {event.receiver && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{event.receiver}</span>
              </div>
            )}
            {event.document && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{event.document}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Observation */}
      {event.observation && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
              Observação
            </p>
            <p className="text-sm">{event.observation}</p>
          </CardContent>
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-[11px] uppercase text-muted-foreground tracking-wide">
            Comprovantes
          </p>
          <div className="grid grid-cols-2 gap-2">
            {event.hasPhoto ? (
              <div className="aspect-square rounded-md bg-muted flex flex-col items-center justify-center text-muted-foreground">
                <Camera className="h-6 w-6 mb-1" />
                <span className="text-[10px]">Foto anexada</span>
              </div>
            ) : (
              <div className="aspect-square rounded-md border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground/60">
                <Camera className="h-6 w-6 mb-1" />
                <span className="text-[10px]">Sem foto</span>
              </div>
            )}
            {event.hasSignature ? (
              <div className="aspect-square rounded-md bg-muted flex flex-col items-center justify-center text-muted-foreground">
                <PenLine className="h-6 w-6 mb-1" />
                <span className="text-[10px]">Assinado</span>
              </div>
            ) : (
              <div className="aspect-square rounded-md border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground/60">
                <PenLine className="h-6 w-6 mb-1" />
                <span className="text-[10px]">Sem assinatura</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => navigate('/driver/deliveries')}>
        <Package className="h-4 w-4 mr-2" /> Ir para entregas
      </Button>
    </div>
  );
}