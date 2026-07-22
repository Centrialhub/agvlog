import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Truck, MapPin, PauseCircle, PlayCircle, MoreVertical, User, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useHoldLoad, useUnholdLoad, type Load } from '@/hooks/useLoads';
import { LOAD_STATUS_LABELS, LOAD_KANBAN_COLUMNS, loadKanbanColumn, type LoadKanbanColumn } from '@/lib/status/loadStatus';

interface Props {
  loads: Load[];
}

const COLUMN_TONE: Record<LoadKanbanColumn, string> = {
  hold: 'border-warning/40 bg-warning/5',
  backlog: 'border-border bg-muted/30',
  prep: 'border-border bg-muted/30',
  ready: 'border-info/40 bg-info/5',
  in_route: 'border-primary/40 bg-primary/5',
  done: 'border-success/40 bg-success/5',
};

export default function LoadsKanban({ loads }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const holdMut = useHoldLoad();
  const unholdMut = useUnholdLoad();

  const [holdTarget, setHoldTarget] = useState<Load | null>(null);
  const [holdReason, setHoldReason] = useState('');

  const byColumn = useMemo(() => {
    const map: Record<LoadKanbanColumn, Load[]> = {
      hold: [], backlog: [], prep: [], ready: [], in_route: [], done: [],
    };
    loads.forEach(l => {
      map[loadKanbanColumn(l as any)].push(l);
    });
    return map;
  }, [loads]);

  const submitHold = async () => {
    if (!holdTarget) return;
    try {
      await holdMut.mutateAsync({ id: holdTarget.id, reason: holdReason.trim() || undefined });
      toast({ title: 'Carga colocada em espera' });
      setHoldTarget(null);
      setHoldReason('');
    } catch (e: any) {
      toast({ title: 'Erro ao pausar', description: e.message, variant: 'destructive' });
    }
  };

  const doUnhold = async (l: Load) => {
    try {
      await unholdMut.mutateAsync(l.id);
      toast({ title: 'Carga retomada' });
    } catch (e: any) {
      toast({ title: 'Erro ao retomar', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {LOAD_KANBAN_COLUMNS.map(col => {
          const items = byColumn[col.id];
          return (
            <div key={col.id} className={`rounded-lg border ${COLUMN_TONE[col.id]} flex flex-col min-h-[300px]`}>
              <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{col.label}</span>
                <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground text-center py-4">—</div>
                ) : items.map(l => {
                  const holded = col.id === 'hold';
                  return (
                    <Card
                      key={l.id}
                      className="cursor-pointer hover:shadow-sm transition-shadow"
                      onClick={() => navigate(`/loads/${l.id}`)}
                    >
                      <CardContent className="p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{l.load_number}</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={e => e.stopPropagation()}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate(`/loads/${l.id}`); }}>
                                <FileText className="h-4 w-4 mr-2" /> Abrir detalhes
                              </DropdownMenuItem>
                              {holded ? (
                                <DropdownMenuItem onClick={e => { e.stopPropagation(); doUnhold(l); }}>
                                  <PlayCircle className="h-4 w-4 mr-2" /> Retomar
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={e => { e.stopPropagation(); setHoldTarget(l); setHoldReason(''); }}>
                                  <PauseCircle className="h-4 w-4 mr-2" /> Colocar em espera
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {LOAD_STATUS_LABELS[l.status] || l.status}
                        </Badge>
                        {l.destination && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{l.destination}</span>
                          </div>
                        )}
                        {l.vehicles?.plate && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Truck className="h-3 w-3 shrink-0" />
                            <span className="truncate">{l.vehicles.plate}</span>
                          </div>
                        )}
                        {l.drivers?.name && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{l.drivers.name}</span>
                          </div>
                        )}
                        {holded && l.hold_reason && (
                          <div className="text-[11px] text-warning-foreground bg-warning/10 rounded px-1.5 py-1 mt-1 line-clamp-2">
                            {l.hold_reason}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                          <span>{(l.total_pallet_count || 0)}p</span>
                          {holded ? (
                            <button
                              className="text-primary hover:underline"
                              onClick={e => { e.stopPropagation(); doUnhold(l); }}
                              disabled={unholdMut.isPending}
                            >
                              Retomar
                            </button>
                          ) : (
                            <button
                              className="text-muted-foreground hover:text-warning"
                              onClick={e => { e.stopPropagation(); setHoldTarget(l); setHoldReason(''); }}
                              disabled={holdMut.isPending}
                            >
                              Pausar
                            </button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!holdTarget} onOpenChange={o => { if (!o) { setHoldTarget(null); setHoldReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Colocar carga em espera</DialogTitle>
            <DialogDescription>
              A carga <strong>{holdTarget?.load_number}</strong> ficará fora do fluxo de despacho
              (não aparece em roteirização nem no app do motorista) até ser retomada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Motivo (opcional)</label>
            <Textarea
              value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              placeholder="Ex.: aguardando confirmação do cliente, veículo indisponível..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHoldTarget(null)}>Cancelar</Button>
            <Button onClick={submitHold} disabled={holdMut.isPending}>
              <PauseCircle className="h-4 w-4 mr-1" /> Colocar em espera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}