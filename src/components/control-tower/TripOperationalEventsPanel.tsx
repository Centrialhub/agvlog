import { AlertTriangle, CheckCircle2, ExternalLink, Eye, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  EVENT_TYPE_LABELS,
  SEVERITY_LABELS,
  type OperationalEventType,
} from '@/hooks/useOperationalEvents';
import { useTripOperationalEvents } from '@/hooks/useTripOperationalEvents';

const SEVERITY_TONE: Record<string, string> = {
  low: 'border-blue-300 text-blue-700 dark:text-blue-300',
  medium: 'border-amber-300 text-amber-700 dark:text-amber-300',
  high: 'border-orange-300 text-orange-700 dark:text-orange-300',
  critical: 'border-destructive/50 text-destructive',
};

function eventTypeLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType as OperationalEventType]
    ?? eventType.split('_').join(' ').replace(/^./, (letter: string) => letter.toUpperCase());
}

function eventTime(createdAt: string) {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime())
    ? 'horário indisponível'
    : value.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function TripOperationalEventsPanel({ tripId }: { tripId: string }) {
  const query = useTripOperationalEvents(tripId);
  const events = query.isError ? [] : query.data ?? [];

  return (
    <section aria-labelledby="trip-occurrences-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 id="trip-occurrences-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ocorrências da viagem
        </h4>
        {!query.isError && !query.isPending && (
          <Badge variant="secondary" className="text-[10px]">{events.length}</Badge>
        )}
      </div>

      {query.isPending ? (
        <p role="status" className="rounded-md border p-3 text-xs text-muted-foreground">
          Carregando ocorrências…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="text-destructive">Não foi possível consultar as ocorrências. Nenhum estado vazio foi presumido.</p>
          <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
            {query.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-md border p-3 text-xs text-muted-foreground">
          Nenhuma ocorrência registrada para esta viagem.
        </p>
      ) : (
        <ul aria-label="Ocorrências da viagem" className="space-y-2">
          {events.slice(0, 5).map((event) => (
            <li key={event.id} className="rounded-md border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {event.resolved_at
                  ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                  : <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />}
                <span className="font-medium">{eventTypeLabel(event.event_type)}</span>
                <Badge variant="outline" className={`text-[10px] ${SEVERITY_TONE[event.severity] ?? ''}`}>
                  {SEVERITY_LABELS[event.severity] ?? event.severity}
                </Badge>
                {event.visible_to_client ? (
                  <Badge variant="outline" className="text-[10px]">
                    <Eye aria-hidden="true" className="mr-1 h-3 w-3" />
                    {event.client_action_required ? 'Portal · ação necessária' : 'Visível no portal'}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    <Shield aria-hidden="true" className="mr-1 h-3 w-3" />Somente operação
                  </Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {event.description?.trim() || 'Sem descrição informada.'}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">{eventTime(event.created_at)}</p>
            </li>
          ))}
        </ul>
      )}

      <Button asChild size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs">
        <Link to="/events">
          <ExternalLink aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
          Abrir eventos operacionais
        </Link>
      </Button>
    </section>
  );
}
