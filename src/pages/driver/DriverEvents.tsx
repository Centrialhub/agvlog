import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Package, CheckCircle2, AlertTriangle, FileText, ChevronRight, Clock, MapPin } from 'lucide-react';
import DemoBanner from '@/components/driver/DemoBanner';

export type DemoEvent = {
  id: string;
  type: 'finalizador' | 'informativo';
  code: string;
  label: string;
  stopName: string;
  invoice?: string;
  receiver?: string;
  document?: string;
  observation?: string;
  occurredAt: string;
  hasPhoto?: boolean;
  hasSignature?: boolean;
};

export const DEMO_EVENTS_INITIAL: DemoEvent[] = [
  {
    id: 'evt-1',
    type: 'finalizador',
    code: 'ENT',
    label: 'Entregue',
    stopName: 'AMANDA D - PAI PEDRO',
    invoice: '12345',
    receiver: 'Maria Silva',
    document: '123.456.789-00',
    occurredAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    hasPhoto: true,
    hasSignature: true,
  },
  {
    id: 'evt-2',
    type: 'informativo',
    code: 'CHE',
    label: 'Cheguei no cliente',
    stopName: 'LINDSAY @ - PIRAPORA',
    invoice: '12346',
    occurredAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: 'evt-3',
    type: 'finalizador',
    code: 'REC',
    label: 'Recusado',
    stopName: 'IRMÃOS FERREIRA - JAÍBA',
    invoice: '12347',
    receiver: 'João Pereira',
    document: '987.654.321-00',
    observation: 'Cliente recusou por divergência de quantidade.',
    occurredAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    hasPhoto: true,
  },
  {
    id: 'evt-4',
    type: 'informativo',
    code: 'SAI',
    label: 'Saída para entrega',
    stopName: 'CG BEATRIZ - PIRAPORA',
    invoice: '12348',
    occurredAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'evt-5',
    type: 'finalizador',
    code: 'ENT',
    label: 'Entregue parcial',
    stopName: 'VICTORIA - JAÍBA',
    invoice: '12349',
    receiver: 'Carlos Souza',
    observation: '2 volumes danificados.',
    occurredAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
    hasPhoto: true,
    hasSignature: true,
  },
];

export default function DriverEvents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'finalizador' | 'informativo'>('all');
  const [events] = useState<DemoEvent[]>(DEMO_EVENTS_INITIAL);
  const [demoActive, setDemoActive] = useState(true);

  const filtered = useMemo(() => {
    let list = events;
    if (tab !== 'all') list = list.filter((e) => e.type === tab);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.stopName.toLowerCase().includes(q) ||
          e.invoice?.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q),
      );
    }
    return list;
  }, [events, search, tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Eventos lançados</h1>
        <p className="text-sm text-muted-foreground">Histórico de eventos da viagem</p>
      </div>

      {demoActive && (
        <DemoBanner
          message="Modo demonstração — eventos fictícios."
          onReset={() => setDemoActive(true)}
        />
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, NF ou evento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="all" className="text-xs">Todos ({events.length})</TabsTrigger>
          <TabsTrigger value="finalizador" className="text-xs">
            Finalizadores ({events.filter((e) => e.type === 'finalizador').length})
          </TabsTrigger>
          <TabsTrigger value="informativo" className="text-xs">
            Informativos ({events.filter((e) => e.type === 'informativo').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhum evento encontrado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajuste a busca ou filtros para ver outros eventos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((evt) => {
            const isFinal = evt.type === 'finalizador';
            const Icon = isFinal ? CheckCircle2 : AlertTriangle;
            return (
              <Card
                key={evt.id}
                className="cursor-pointer hover:bg-accent/40 transition-colors active:bg-accent"
                onClick={() => navigate(`/driver/events/${evt.id}`)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                      isFinal ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{evt.label}</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {evt.code}
                      </Badge>
                      {evt.invoice && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          NF {evt.invoice}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{evt.stopName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        {new Date(evt.occurredAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}