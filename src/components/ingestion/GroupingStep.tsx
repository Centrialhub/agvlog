import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LoadSuggestion } from '@/lib/ingestionValidator';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, CheckCircle, Loader2, MapPin, Truck, AlertTriangle, FileSearch, Printer, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Vehicle {
  id: string;
  plate: string;
  nickname: string | null;
  max_pallets: number | null;
  max_weight_kg: number | null;
}

interface Driver {
  id: string;
  name: string;
  active: boolean;
}

interface OperationalRouteOption {
  id: string;
  name: string;
  destinations: { name: string }[];
}

interface GroupingStepProps {
  suggestions: LoadSuggestion[];
  vehicles: Vehicle[];
  drivers: Driver[];
  routes?: OperationalRouteOption[];
  executing: boolean;
  onBack: () => void;
  onExecute: (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => void;
}

const STORAGE_KEY = 'ingestion_grouping_state';

function findBestVehicle(
  pallets: number,
  weightKg: number,
  vehicles: Vehicle[],
  alreadyAssigned: Set<string>,
): Vehicle | null {
  const candidates = vehicles
    .filter(v => !alreadyAssigned.has(v.id))
    .filter(v => {
      const fitsPallets = (v.max_pallets || 0) >= pallets;
      const fitsWeight = !weightKg || !v.max_weight_kg || v.max_weight_kg >= weightKg;
      return fitsPallets && fitsWeight;
    })
    .sort((a, b) => (a.max_pallets || 0) - (b.max_pallets || 0));

  return candidates[0] || null;
}

export default function GroupingStep({ suggestions, vehicles, drivers, routes = [], executing, onBack, onExecute }: GroupingStepProps) {
  const [assignments, setAssignments] = useState<Map<number, { vehicleId: string | null; driverId: string | null }>>(new Map());
  const [autoSuggested, setAutoSuggested] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [saved, setSaved] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const vehiclesWithCapacity = useMemo(() => vehicles.filter(v => (v.max_pallets || 0) > 0), [vehicles]);
  const activeDrivers = drivers.filter(d => d.active);

  // ──────────── Auto-save / restore ────────────
  const persistState = useCallback(() => {
    try {
      const serializable = {
        ts: Date.now(),
        assignments: Array.from(assignments.entries()).map(([k, v]) => [k, v]),
        suggestionsSnapshot: suggestions.map(s => ({
          region: s.region,
          routeName: s.routeName,
          totalPallets: s.totalPallets,
          totalWeight: s.totalWeight,
          totalValue: s.totalValue,
          docCount: s.documents.length,
          orderCount: s.orders.length,
          cities: [...new Set(s.documents.map(d => d.source.recipientCity).filter(Boolean))],
          docs: s.documents.map(d => ({
            invoiceNumber: d.source.invoiceNumber,
            recipientName: d.source.recipientName,
            recipientCity: d.source.recipientCity,
            pallets: d.source.estimatedPallets,
            weight: d.source.totalWeight,
            value: d.source.totalValue,
          })),
          orders: s.orders.map(o => ({
            orderNumber: o.source.orderNumber,
            clientName: o.source.clientName,
            destination: o.source.destination,
            pallets: o.source.palletCount,
            weight: o.source.weightKg,
          })),
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Storage full or unavailable
    }
  }, [assignments, suggestions]);

  // Restore assignments from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Only restore if less than 4 hours old and same number of suggestions
      if (Date.now() - parsed.ts > 4 * 60 * 60 * 1000) return;
      if (parsed.suggestionsSnapshot?.length !== suggestions.length) return;
      const restored = new Map<number, { vehicleId: string | null; driverId: string | null }>();
      for (const [k, v] of parsed.assignments) {
        restored.set(Number(k), v as any);
      }
      if (restored.size > 0) {
        setAssignments(restored);
        setAutoSuggested(true); // Don't overwrite with auto
        toast({ title: 'Sessão restaurada', description: 'Agrupamento recuperado automaticamente.' });
      }
    } catch {
      // Ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on every assignment change
  useEffect(() => {
    if (assignments.size === 0) return;
    const timer = setTimeout(() => persistState(), 1500);
    return () => clearTimeout(timer);
  }, [assignments, persistState]);

  // Auto-suggest vehicles on mount
  useEffect(() => {
    if (autoSuggested || vehiclesWithCapacity.length === 0 || suggestions.length === 0) return;

    const newAssignments = new Map<number, { vehicleId: string | null; driverId: string | null }>();
    const usedVehicles = new Set<string>();

    const sortedIndices = suggestions
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.totalPallets - a.s.totalPallets);

    for (const { s, i } of sortedIndices) {
      const best = findBestVehicle(s.totalPallets, s.totalWeight, vehiclesWithCapacity, usedVehicles);
      if (best) {
        usedVehicles.add(best.id);
        newAssignments.set(i, { vehicleId: best.id, driverId: null });
      }
    }

    if (newAssignments.size > 0) {
      setAssignments(newAssignments);
    }
    setAutoSuggested(true);
  }, [suggestions, vehiclesWithCapacity, autoSuggested]);

  const setAssignment = (idx: number, field: 'vehicleId' | 'driverId', value: string | null) => {
    setAssignments(prev => {
      const next = new Map(prev);
      const current = next.get(idx) || { vehicleId: null, driverId: null };
      next.set(idx, { ...current, [field]: value });
      return next;
    });
  };

  const getOccupancy = (suggestion: LoadSuggestion, idx: number) => {
    const assignment = assignments.get(idx);
    const vehicle = assignment?.vehicleId ? vehicles.find(v => v.id === assignment.vehicleId) : null;
    if (!vehicle || !vehicle.max_pallets) return null;

    const palletPct = Math.round((suggestion.totalPallets / vehicle.max_pallets) * 100);
    const weightPct = vehicle.max_weight_kg && suggestion.totalWeight > 0
      ? Math.round((suggestion.totalWeight / vehicle.max_weight_kg) * 100)
      : null;
    const maxPct = Math.max(palletPct, weightPct || 0);

    return { palletPct, weightPct, maxPct, vehicle };
  };

  const noVehiclesWithCapacity = vehiclesWithCapacity.length === 0;

  const printStyles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; padding: 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: landscape; margin: 6mm; }
    h1 { font-size: 15px; font-weight: 900; margin-bottom: 2px; border-bottom: 3px solid #000; padding-bottom: 4px; text-transform: uppercase; }
    .subtitle { font-size: 10px; color: #333; margin-bottom: 10px; font-weight: 600; }
    .city-section { margin-bottom: 12px; page-break-inside: avoid; }
    .city-header { background: #d9d9d9; padding: 5px 8px; font-size: 12px; font-weight: 900; color: #000; border: 2px solid #000; display: flex; justify-content: space-between; align-items: center; }
    .city-meta { display: flex; gap: 20px; padding: 3px 8px; background: #eee; border: 1px solid #000; border-top: none; font-size: 10px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { text-align: left; background: #e0e0e0; padding: 4px 5px; border: 1.5px solid #000; font-weight: 900; font-size: 9px; white-space: nowrap; color: #000; text-transform: uppercase; }
    td { padding: 3px 5px; border: 1px solid #000; color: #000; font-weight: 600; }
    tr:nth-child(even) td { background: #f5f5f5; }
    .right { text-align: right; }
    .center { text-align: center; }
    .total-row td { background: #d9d9d9 !important; font-weight: 900; font-size: 10px; border-top: 2.5px solid #000; }
    .grand-totals { margin-top: 14px; padding: 8px 10px; background: #000; color: #fff; font-size: 12px; font-weight: 900; border: 3px solid #000; display: flex; gap: 20px; flex-wrap: wrap; }
    .grand-totals span { white-space: nowrap; }
    .footer { margin-top: 10px; text-align: center; font-size: 8px; color: #666; border-top: 1px solid #999; padding-top: 4px; }
    .route-break { page-break-before: always; }
    .assign-info { font-size: 11px; color: #000; background: #e8f5e9; padding: 4px 8px; border: 1px solid #000; margin-bottom: 8px; font-weight: 700; }
    @media print { body { padding: 5mm; } .city-section { page-break-inside: avoid; } }
  `;

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const fmtN = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const buildCityBlocks = (docs: { city: string; state: string; remetente: string; destinatario: string; bairro: string; nfNumber: string; emissao: string; valor: number; peso: number; volumes: number }[]) => {
    const cityMap = new Map<string, typeof docs>();
    docs.forEach(d => {
      const key = d.city.toUpperCase();
      if (!cityMap.has(key)) cityMap.set(key, []);
      cityMap.get(key)!.push(d);
    });

    let totalNotas = 0, totalEntregas = 0, totalValor = 0, totalPeso = 0, totalVolumes = 0;
    let html = '';

    cityMap.forEach((cityDocs, cityName) => {
      const entregas = new Set(cityDocs.map(d => d.destinatario)).size;
      const notas = cityDocs.length;
      const valor = cityDocs.reduce((s, d) => s + d.valor, 0);
      const peso = cityDocs.reduce((s, d) => s + d.peso, 0);
      const volumes = cityDocs.reduce((s, d) => s + d.volumes, 0);
      totalNotas += notas; totalEntregas += entregas; totalValor += valor; totalPeso += peso; totalVolumes += volumes;

      const state = cityDocs[0]?.state || '';
      const rows = cityDocs.map(d => `
        <tr>
          <td>${d.remetente}</td>
          <td>${d.destinatario}</td>
          <td>${d.city}</td>
          <td class="center">${d.bairro}</td>
          <td class="center">${d.nfNumber}</td>
          <td class="center">${d.emissao}</td>
          <td class="right">${fmt(d.valor)}</td>
          <td class="right">${fmtN(d.peso)}</td>
          <td class="center">${d.volumes}</td>
        </tr>`).join('');

      html += `
        <div class="city-section">
          <div class="city-header">
            <span>Cidade: ${cityName}${state ? ' - ' + state : ''}</span>
          </div>
          <div class="city-meta">
            <span>Qtd Entregas: ${entregas}</span>
            <span>Qtd Notas: ${notas}</span>
          </div>
          <table>
            <thead><tr>
              <th>Remetente</th><th>Destinatário</th><th>Cidade</th><th class="center">Bairro</th>
              <th class="center">Nº Nota</th><th class="center">Emissão</th>
              <th class="right">Vlr. Nota</th><th class="right">Peso</th><th class="center">Volumes</th>
            </tr></thead>
            <tbody>
              ${rows}
              <tr class="total-row">
                <td colspan="5">Total Cidade:</td>
                <td></td>
                <td class="right">${fmt(valor)}</td>
                <td class="right">${fmtN(peso)}</td>
                <td class="center">${volumes}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    });

    return { html, totalNotas, totalEntregas, totalValor, totalPeso, totalVolumes };
  };

  const collectDocs = (s: LoadSuggestion) =>
    s.documents.map(doc => ({
      city: doc.source.recipientCity || 'SEM CIDADE',
      state: doc.source.recipientState || '',
      remetente: doc.source.emitterName || '—',
      destinatario: doc.source.recipientName || '—',
      bairro: (doc.source.recipientAddress || '').split(',')[0]?.trim() || '—',
      nfNumber: doc.source.invoiceNumber || '—',
      emissao: doc.source.issueDate ? new Date(doc.source.issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '',
      valor: doc.source.totalValue || 0,
      peso: doc.source.totalWeight || 0,
      volumes: doc.source.totalVolume || 0,
    }));

  const handlePrint = () => {
    const allDocs = suggestions.flatMap(s => collectDocs(s));
    const { html: cityBlocks, totalNotas, totalEntregas, totalValor, totalPeso, totalVolumes } = buildCityBlocks(allDocs);

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>Análise de Cargas</title><style>${printStyles}</style></head><body>
      <h1>Análise de Cargas — Conferência Galpão</h1>
      <div class="subtitle">${new Date().toLocaleDateString('pt-BR')} • ${suggestions.length} cargas • ${totalNotas} notas</div>
      ${cityBlocks}
      <div class="grand-totals">
        <span>Total Geral</span><span>Notas: ${totalNotas}</span><span>Entregas: ${totalEntregas}</span>
        <span>Valor: ${fmt(totalValor)}</span><span>Peso: ${fmtN(totalPeso)}</span><span>Volumes: ${totalVolumes}</span>
      </div>
      <div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} — Sistema de Ingestão Logística</div>
    </body></html>`);
    win.document.close();
    win.print();
  };

  const handlePrintPerRoute = () => {
    const pages: string[] = [];

    suggestions.forEach((s, i) => {
      const docs = collectDocs(s);
      if (docs.length === 0) return;
      const { html: cityBlocks, totalNotas, totalEntregas, totalValor, totalPeso, totalVolumes } = buildCityBlocks(docs);
      const assignment = assignments.get(i);
      const vehicle = assignment?.vehicleId ? vehicles.find(v => v.id === assignment.vehicleId) : null;
      const driver = assignment?.driverId ? drivers.find(d => d.id === assignment.driverId) : null;

      const vehicleInfo = vehicle ? `🚛 ${vehicle.plate} (${vehicle.max_pallets || '?'}p)` : '';
      const driverInfo = driver ? `👤 ${driver.name}` : '';
      const assignLine = (vehicleInfo || driverInfo) ? `<div style="font-size:11px;color:#333;background:#f0fdf4;padding:4px 8px;border-radius:4px;margin-bottom:8px">${vehicleInfo}${driverInfo ? (vehicleInfo ? ' — ' : '') + driverInfo : ''}</div>` : '';

      pages.push(`
        <div class="${i > 0 ? 'route-break' : ''}">
          <h1>Rota: ${s.routeName || s.region}</h1>
          <div class="subtitle">${new Date().toLocaleDateString('pt-BR')} • Carga ${i + 1} de ${suggestions.length}</div>
          ${assignLine}
          ${cityBlocks}
          <div class="grand-totals">
            <span>Total Rota</span><span>Notas: ${totalNotas}</span><span>Entregas: ${totalEntregas}</span>
            <span>Valor: ${fmt(totalValor)}</span><span>Peso: ${fmtN(totalPeso)}</span><span>Volumes: ${totalVolumes}</span>
          </div>
          <div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} — Sistema de Ingestão Logística</div>
        </div>`);
    });

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>Análise por Rota</title><style>${printStyles}</style></head><body>${pages.join('')}</body></html>`);
    win.document.close();
    win.print();
  };

  const handleManualSave = () => {
    persistState();
    toast({ title: 'Salvo!', description: 'Estado do agrupamento salvo com sucesso.' });
  };

  // Grand totals
  const totals = useMemo(() => ({
    pallets: suggestions.reduce((s, g) => s + g.totalPallets, 0),
    weight: suggestions.reduce((s, g) => s + g.totalWeight, 0),
    value: suggestions.reduce((s, g) => s + g.totalValue, 0),
    docs: suggestions.reduce((s, g) => s + g.documents.length, 0),
    orders: suggestions.reduce((s, g) => s + g.orders.length, 0),
  }), [suggestions]);

  return (
    <div className="space-y-4">
      {noVehiclesWithCapacity && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-warning">Nenhum veículo com capacidade cadastrada.</span>{' '}
              <span className="text-muted-foreground">
                Cadastre paletes máx. e peso máx. nos veículos para sugestão automática.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis + Save buttons */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowAnalysis(true)} className="gap-1.5">
          <FileSearch className="h-4 w-4" /> Analisar Cargas
        </Button>
        <Button variant="outline" size="sm" onClick={handleManualSave} className="gap-1.5">
          <Save className="h-4 w-4" /> {saved ? 'Salvo ✓' : 'Salvar'}
        </Button>
        <span className="text-[10px] text-muted-foreground ml-1">Auto-salvo a cada alteração</span>
      </div>

      {suggestions.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma sugestão gerada — verifique os dados importados</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s, i) => {
            const occ = getOccupancy(s, i);
            const isOver = occ && occ.maxPct > 100;
            const isUnder = occ && occ.maxPct < 50;
            const assignment = assignments.get(i);
            const isAutoSuggested = assignment?.vehicleId && autoSuggested;

            return (
              <Card key={i} className={isOver ? 'border-destructive/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.routeName ? (
                          <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                            <MapPin className="h-3 w-3" />
                            {s.routeName}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-warning border-warning/30">
                            <MapPin className="h-3 w-3" />
                            {s.region}
                            <span className="text-[9px] ml-1">(sem rota)</span>
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">{s.documents.length} NF-e</Badge>
                        {s.orders.length > 0 && <Badge variant="outline" className="text-[10px]">{s.orders.length} pedidos</Badge>}
                      </div>
                      {s.routeName && s.documents.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...new Set(s.documents.map(d => d.source.recipientCity).filter(Boolean))].map((city, ci) => (
                            <span key={ci} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{city}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{s.totalPallets} paletes</span>
                        {s.totalWeight > 0 && <span>{s.totalWeight.toLocaleString('pt-BR')} kg</span>}
                        {s.totalValue > 0 && <span>R$ {s.totalValue.toLocaleString('pt-BR')}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="relative">
                        <Select
                          value={assignment?.vehicleId || '__none__'}
                          onValueChange={v => setAssignment(i, 'vehicleId', v === '__none__' ? null : v)}
                        >
                          <SelectTrigger className={`w-[150px] h-8 text-xs ${isAutoSuggested && assignment?.vehicleId ? 'border-primary/40 bg-primary/5' : ''}`}>
                            <SelectValue placeholder="Veículo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {vehiclesWithCapacity.map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                <div className="flex items-center gap-1">
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span>{v.plate}</span>
                                  <span className="text-muted-foreground">
                                    ({v.max_pallets}p{v.max_weight_kg ? ` / ${(v.max_weight_kg / 1000).toFixed(0)}t` : ''})
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                            {vehicles.filter(v => !(v.max_pallets && v.max_pallets > 0)).length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] text-muted-foreground border-t">Sem capacidade cadastrada:</div>
                                {vehicles.filter(v => !(v.max_pallets && v.max_pallets > 0)).map(v => (
                                  <SelectItem key={v.id} value={v.id}>
                                    {v.plate} {v.nickname ? `(${v.nickname})` : ''}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        {isAutoSuggested && assignment?.vehicleId && (
                          <span className="absolute -top-2 -right-1 text-[8px] bg-primary text-primary-foreground px-1 rounded">auto</span>
                        )}
                      </div>

                      <Select
                        value={assignment?.driverId || '__none__'}
                        onValueChange={v => setAssignment(i, 'driverId', v === '__none__' ? null : v)}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue placeholder="Motorista" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem motorista</SelectItem>
                          {activeDrivers.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {occ ? (
                        <div className="w-24 text-center space-y-0.5">
                          <div>
                            <Progress value={Math.min(occ.palletPct, 100)} className={`h-1.5 ${occ.palletPct > 100 ? '[&>div]:bg-destructive' : occ.palletPct < 50 ? '[&>div]:bg-warning' : ''}`} />
                            <span className={`text-[9px] ${occ.palletPct > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {occ.palletPct}% paletes
                            </span>
                          </div>
                          {occ.weightPct !== null && (
                            <div>
                              <Progress value={Math.min(occ.weightPct, 100)} className={`h-1.5 ${occ.weightPct > 100 ? '[&>div]:bg-destructive' : occ.weightPct < 50 ? '[&>div]:bg-warning' : ''}`} />
                              <span className={`text-[9px] ${occ.weightPct > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {occ.weightPct}% peso
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-24 text-center text-[10px] text-muted-foreground">Sem veículo</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
        <Button onClick={() => { localStorage.removeItem(STORAGE_KEY); onExecute(assignments); }} disabled={executing || suggestions.length === 0}>
          {executing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</> : <>Confirmar e Executar <CheckCircle className="h-4 w-4 ml-2" /></>}
        </Button>
      </div>

      {/* ──────── Analysis Modal ──────── */}
      <Dialog open={showAnalysis} onOpenChange={setShowAnalysis}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" /> Análise de Cargas
            </DialogTitle>
          </DialogHeader>

          <div ref={analysisRef}>
            <h1 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>Análise de Cargas — Remanejamento</h1>
            <div className="subtitle" style={{ fontSize: '11px', color: '#666', marginBottom: '16px' }}>
              {new Date().toLocaleDateString('pt-BR')} • {totals.docs} NF-e • {totals.orders} pedidos • {totals.pallets} paletes • {totals.weight.toLocaleString('pt-BR')} kg
            </div>

            {suggestions.map((s, i) => {
              const assignment = assignments.get(i);
              const vehicle = assignment?.vehicleId ? vehicles.find(v => v.id === assignment.vehicleId) : null;
              const driver = assignment?.driverId ? drivers.find(d => d.id === assignment.driverId) : null;
              const occ = getOccupancy(s, i);
              const cities = [...new Set(s.documents.map(d => d.source.recipientCity).filter(Boolean))];

              return (
                <div key={i} className="load-card" style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '10px', marginBottom: '12px', pageBreakInside: 'avoid' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '6px', marginBottom: '6px' }}>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                        {s.routeName || s.region}
                      </span>
                      {!s.routeName && (
                        <span style={{ fontSize: '10px', color: '#92400e', marginLeft: '8px' }}>(sem rota cadastrada)</span>
                      )}
                    </div>
                    <span style={{ fontSize: '10px', background: '#e8f0fe', color: '#1a56db', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      Carga {i + 1}
                    </span>
                  </div>

                  {/* Vehicle & driver info */}
                  {(vehicle || driver) && (
                    <div style={{ fontSize: '11px', color: '#333', background: '#f0fdf4', padding: '4px 8px', borderRadius: '4px', marginBottom: '6px' }}>
                      {vehicle && <span>🚛 {vehicle.plate} ({vehicle.max_pallets}p{vehicle.max_weight_kg ? ` / ${(vehicle.max_weight_kg / 1000).toFixed(0)}t` : ''})</span>}
                      {driver && <span style={{ marginLeft: vehicle ? '12px' : 0 }}>👤 {driver.name}</span>}
                      {occ && (
                        <span style={{
                          marginLeft: '12px',
                          fontWeight: 'bold',
                          color: occ.maxPct > 100 ? '#dc2626' : occ.maxPct < 50 ? '#ca8a04' : '#16a34a',
                        }}>
                          {occ.palletPct}% ocupação
                        </span>
                      )}
                    </div>
                  )}

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '6px', fontSize: '11px', color: '#444' }}>
                    <span><span style={{ color: '#888' }}>Paletes:</span> {s.totalPallets}</span>
                    <span><span style={{ color: '#888' }}>Peso:</span> {s.totalWeight.toLocaleString('pt-BR')} kg</span>
                    {s.totalValue > 0 && <span><span style={{ color: '#888' }}>Valor:</span> R$ {s.totalValue.toLocaleString('pt-BR')}</span>}
                    <span><span style={{ color: '#888' }}>Paradas:</span> {s.documents.length + s.orders.length}</span>
                  </div>

                  {cities.length > 0 && (
                    <div style={{ fontSize: '10px', color: '#666', marginBottom: '6px' }}>
                      Cidades: {cities.join(', ')}
                    </div>
                  )}

                  {/* Documents table */}
                  {s.documents.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '4px' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>NF-e</th>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Destinatário</th>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Cidade</th>
                          <th style={{ textAlign: 'right', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Paletes</th>
                          <th style={{ textAlign: 'right', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Peso (kg)</th>
                          <th style={{ textAlign: 'right', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.documents.map((doc, di) => (
                          <tr key={di}>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{doc.source.invoiceNumber}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{doc.source.recipientName || '—'}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{doc.source.recipientCity || '—'}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{doc.source.estimatedPallets}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{doc.source.totalWeight.toLocaleString('pt-BR')}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>R$ {doc.source.totalValue.toLocaleString('pt-BR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Orders table */}
                  {s.orders.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Pedido</th>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Cliente</th>
                          <th style={{ textAlign: 'left', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Destino</th>
                          <th style={{ textAlign: 'right', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Paletes</th>
                          <th style={{ textAlign: 'right', background: '#f5f5f5', padding: '4px 6px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>Peso (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.orders.map((order, oi) => (
                          <tr key={oi}>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{order.source.orderNumber}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{order.source.clientName || '—'}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee' }}>{order.source.destination || '—'}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{order.source.palletCount || '—'}</td>
                            <td style={{ padding: '3px 6px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{order.source.weightKg ? order.source.weightKg.toLocaleString('pt-BR') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setShowAnalysis(false)}>Fechar</Button>
            <Button variant="outline" onClick={handlePrintPerRoute} className="gap-1.5">
              <Printer className="h-4 w-4" /> Imprimir por Rota
            </Button>
            <Button onClick={handlePrint} className="gap-1.5">
              <Printer className="h-4 w-4" /> Imprimir Tudo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
