import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, RotateCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useEmitters } from '@/hooks/useEmitters';
import { useHubCredentials } from '@/hooks/useEmitters';
import { useVehicles } from '@/hooks/useVehicles';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { useIssueCTe } from '@/hooks/useIssueCTe';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';
import { buildCtePayload, type CteTakerRole, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';

interface DriverOpt {
  id: string;
  name: string;
  cpf: string | null;
}

interface EditableCte {
  key: string;
  emitterId: string;
  remitterName: string;
  remitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientCity: string;
  recipientState: string;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeCnpj: string;
  takerRole: CteTakerRole;
  takerName: string;
  takerCnpj: string;
  driverId: string | null;
  driverName: string;
  driverCpf: string;
  vehicleId: string | null;
  vehiclePlate: string;
  vehicleState: string;
  vehicleRenavam: string;
  nature: string;
  cfop: string;
  observations: string;
  freightValue: number;
  cargoValue: number;
  weightKg: number;
  palletCount: number;
  clientId: string | null;
  invoices: {
    id: string;
    access_key: string | null;
    number: string | null;
    series: string | null;
    issue_date: string | null;
    value: number | null;
    weight_kg: number | null;
  }[];
  loadIds: string[];
  fiscalDocumentIds: string[];
  transmitted?: 'ok' | 'error' | null;
  transmitMessage?: string;
}

function groupToEditable(g: CteGroupPreview, defaultEmitterId: string): EditableCte {
  const first = g.documents[0] as any;
  return {
    key: g.key,
    emitterId: defaultEmitterId,
    remitterName: g.remitter || '',
    remitterCnpj: first?.remitter_cnpj || '',
    recipientName: g.recipient || '',
    recipientCnpj: first?.recipient_cnpj || '',
    recipientCity: g.recipient_city || '',
    recipientState: g.recipient_state || '',
    consigneeClientId: null,
    consigneeName: '',
    consigneeCnpj: '',
    takerRole: 'destinatario',
    takerName: '',
    takerCnpj: '',
    driverId: null,
    driverName: '',
    driverCpf: '',
    vehicleId: null,
    vehiclePlate: '',
    vehicleState: '',
    vehicleRenavam: '',
    nature: 'PRESTACAO DE SERVICO DE TRANSPORTE',
    cfop: '',
    observations: '',
    freightValue: g.freight_value,
    cargoValue: g.cargo_value,
    weightKg: g.weight_kg,
    palletCount: g.pallet_count,
    clientId: g.client_id,
    invoices: g.documents.map((d: any) => ({
      id: d.id,
      access_key: d.access_key || null,
      number: d.invoice_number || null,
      series: d.invoice_series || null,
      issue_date: d.issue_date || null,
      value: d.value ?? null,
      weight_kg: d.weight_kg ?? null,
    })),
    loadIds: g.load_ids,
    fiscalDocumentIds: g.fiscal_document_ids,
  };
}

function toBuildInput(
  e: EditableCte,
  emitter: any,
  environment: 'sandbox' | 'production' = 'sandbox',
): BuildCtePayloadInput {
  return {
    emitter: emitter
      ? {
          id: emitter.id,
          cnpj: emitter.cnpj,
          ie: emitter.ie,
          name: emitter.razao_social || emitter.nome_fantasia || '',
          environment,
          address: {
            street: emitter.endereco?.logradouro || null,
            number: emitter.endereco?.numero || null,
            neighborhood: emitter.endereco?.bairro || null,
            city: emitter.endereco?.municipio || null,
            state: emitter.endereco?.uf || null,
            zip: emitter.endereco?.cep || null,
          },
        }
      : null,
    remitter: e.remitterName
      ? { name: e.remitterName, cnpj: e.remitterCnpj || null }
      : null,
    recipient: e.recipientName
      ? {
          name: e.recipientName,
          cnpj: e.recipientCnpj || null,
          address: { city: e.recipientCity || null, state: e.recipientState || null },
        }
      : null,
    consignee: e.consigneeName
      ? { name: e.consigneeName, cnpj: e.consigneeCnpj || null }
      : null,
    takerRole: e.takerRole,
    takerParty:
      e.takerRole === 'terceiro'
        ? { name: e.takerName, cnpj: e.takerCnpj || null }
        : null,
    driver: e.driverName ? { id: e.driverId, name: e.driverName, cpf: e.driverCpf } : null,
    vehicle: e.vehiclePlate
      ? { id: e.vehicleId, plate: e.vehiclePlate, state: e.vehicleState, renavam: e.vehicleRenavam }
      : null,
    nature: e.nature,
    cfop: e.cfop || null,
    observations: e.observations || null,
    invoices: e.invoices,
    totals: {
      freight_value: e.freightValue,
      cargo_value: e.cargoValue,
      weight_kg: e.weightKg,
      pallet_count: e.palletCount,
    },
  };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: CteGroupPreview[];
}

export function CteEmissionPreviewDialog({ open, onOpenChange, groups }: Props) {
  const { currentTenant } = useTenant();
  const { data: emitters = [] } = useEmitters();
  const { data: vehicles = [] } = useVehicles();
  const { data: clients = [] } = useClients();
  const issueCte = useIssueCTe();

  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [items, setItems] = useState<EditableCte[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [transmitting, setTransmitting] = useState(false);

  const defaultEmitter = emitters.find((e: any) => e.is_default && e.active) || emitters[0];

  useEffect(() => {
    if (!open) return;
    setItems(groups.map((g) => groupToEditable(g, defaultEmitter?.id || '')));
    setActiveIdx(0);
  }, [open, groups, defaultEmitter?.id]);

  useEffect(() => {
    if (!currentTenant?.id) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('drivers')
        .select('id, name, cpf')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      setDrivers(data || []);
    })();
  }, [currentTenant?.id]);

  // Pré-preenche via RPC quando o diálogo abre
  useEffect(() => {
    if (!open || items.length === 0) return;
    (async () => {
      const patched = await Promise.all(
        items.map(async (it) => {
          if (it.loadIds.length === 0) return it;
          const { data } = await (supabase as any).rpc('cte_defaults_for_group', {
            p_load_ids: it.loadIds,
          });
          if (!data) return it;
          const d: any = data;
          return {
            ...it,
            driverId: it.driverId || d.driver?.id || null,
            driverName: it.driverName || d.driver?.name || '',
            driverCpf: it.driverCpf || d.driver?.cpf || '',
            vehicleId: it.vehicleId || d.vehicle?.id || null,
            vehiclePlate: it.vehiclePlate || d.vehicle?.plate || '',
            emitterId: it.emitterId || d.emitter?.id || '',
            nature: it.nature || d.nature_default || 'PRESTACAO DE SERVICO DE TRANSPORTE',
          };
        }),
      );
      setItems(patched);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const active = items[activeIdx];
  const emitterForActive = useMemo(
    () => emitters.find((e: any) => e.id === active?.emitterId) || defaultEmitter,
    [emitters, active?.emitterId, defaultEmitter],
  );

  // Ambiente e disponibilidade da credencial CT-e do emitente ativo
  const { data: activeCreds = [] } = useHubCredentials(emitterForActive?.id);
  const activeCteCred = useMemo(
    () =>
      (activeCreds as any[]).find((c) => c.doc_scope === 'cte' && c.enabled) ||
      (activeCreds as any[]).find((c) => c.doc_scope === 'all' && c.enabled) ||
      null,
    [activeCreds],
  );
  const activeEnvironment: 'sandbox' | 'production' =
    (activeCteCred?.environment as any) === 'production' ? 'production' : 'sandbox';

  const validation = useMemo(() => {
    if (!active) return { ok: false, missing: [] as string[], warnings: [] as string[] };
    const r = buildCtePayload(toBuildInput(active, emitterForActive, activeEnvironment));
    return { ok: r.ok, missing: r.missing, warnings: r.warnings };
  }, [active, emitterForActive, activeEnvironment]);

  const allValid = items.every((it) => {
    const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
    return buildCtePayload(toBuildInput(it, em)).ok;
  });

  function patch(patch: Partial<EditableCte>) {
    setItems((arr) => arr.map((it, i) => (i === activeIdx ? { ...it, ...patch } : it)));
  }

  async function transmit() {
    setTransmitting(true);
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
        // Ambiente da credencial do emitente da vez (CT-e específico → all → sandbox).
        const { data: itCreds } = await (supabase as any)
          .from('hub_fiscal_credentials')
          .select('doc_scope, environment, enabled')
          .eq('emitter_id', em?.id)
          .eq('enabled', true);
        const itCred =
          (itCreds || []).find((c: any) => c.doc_scope === 'cte') ||
          (itCreds || []).find((c: any) => c.doc_scope === 'all') ||
          null;
        const itEnv: 'sandbox' | 'production' =
          itCred?.environment === 'production' ? 'production' : 'sandbox';
        try {
          await issueCte.mutateAsync({
            ...toBuildInput(it, em, itEnv),
            fiscal_document_ids: it.fiscalDocumentIds,
            load_ids: it.loadIds,
            meta: {
              client_id: it.clientId,
              consignee_client_id: it.consigneeClientId,
            },
          });
          setItems((arr) =>
            arr.map((x, idx) => (idx === i ? { ...x, transmitted: 'ok' } : x)),
          );
        } catch (err: any) {
          setItems((arr) =>
            arr.map((x, idx) =>
              idx === i ? { ...x, transmitted: 'error', transmitMessage: err?.message } : x,
            ),
          );
        }
      }
      toast.success('Transmissão concluída — verifique o status de cada CT-e.');
    } finally {
      setTransmitting(false);
    }
  }

  if (!open || items.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent><DialogHeader><DialogTitle>Prévia dos CT-es</DialogTitle></DialogHeader></DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            Prévia editável — CT-e {activeIdx + 1} de {items.length}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] gap-4">
          {/* Navegação entre CT-es */}
          <ScrollArea className="h-[540px] rounded-md border p-2">
            <div className="space-y-1">
              {items.map((it, i) => {
                const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
                const ok = buildCtePayload(toBuildInput(it, em)).ok;
                return (
                  <button
                    key={it.key}
                    onClick={() => setActiveIdx(i)}
                    className={`w-full text-left rounded p-2 text-xs transition-colors ${
                      i === activeIdx ? 'bg-primary/10 border border-primary' : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">#{i + 1}</span>
                      {it.transmitted === 'ok' ? (
                        <Badge variant="default" className="text-[10px]">Enviado</Badge>
                      ) : it.transmitted === 'error' ? (
                        <Badge variant="destructive" className="text-[10px]">Erro</Badge>
                      ) : ok ? (
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-yellow-600" />
                      )}
                    </div>
                    <div className="mt-1 truncate font-medium">{it.remitterName || '—'}</div>
                    <div className="truncate text-muted-foreground">→ {it.recipientName || '—'}</div>
                    <div className="text-muted-foreground">
                      {it.invoices.length} NF · R$ {it.freightValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* Editor do CT-e ativo */}
          <div className="max-h-[540px] overflow-y-auto pr-1">
            {!validation.ok && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Campos obrigatórios ausentes:</strong> {validation.missing.join(', ')}
                </AlertDescription>
              </Alert>
            )}
            {validation.warnings.length > 0 && (
              <Alert className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validation.warnings.join(' • ')}</AlertDescription>
              </Alert>
            )}
            {active.transmitted === 'error' && (
              <Alert variant="destructive" className="mb-3">
                <AlertDescription>{active.transmitMessage || 'Erro na transmissão'}</AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue="partes">
              <TabsList>
                <TabsTrigger value="partes">Partes</TabsTrigger>
                <TabsTrigger value="tomador">Tomador</TabsTrigger>
                <TabsTrigger value="transporte">Transporte</TabsTrigger>
                <TabsTrigger value="carga">Carga & valores</TabsTrigger>
                <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
              </TabsList>

              <TabsContent value="partes" className="space-y-3 pt-3">
                <div>
                  <Label>Emitente</Label>
                  <Select value={active.emitterId} onValueChange={(v) => patch({ emitterId: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione o emitente" /></SelectTrigger>
                    <SelectContent>
                      {emitters.map((e: any) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.razao_social} — CNPJ {e.cnpj}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Remetente</Label>
                    <Input value={active.remitterName} onChange={(e) => patch({ remitterName: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input value={active.remitterCnpj} onChange={(e) => patch({ remitterCnpj: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Destinatário</Label>
                    <Input value={active.recipientName} onChange={(e) => patch({ recipientName: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input value={active.recipientCnpj} onChange={(e) => patch({ recipientCnpj: e.target.value })} />
                  </div>
                  <div>
                    <Label>Município</Label>
                    <Input value={active.recipientCity} onChange={(e) => patch({ recipientCity: e.target.value })} />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input value={active.recipientState} onChange={(e) => patch({ recipientState: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Consignatário (opcional)</Label>
                  <Select
                    value={active.consigneeClientId || 'none'}
                    onValueChange={(v) => {
                      if (v === 'none') return patch({ consigneeClientId: null, consigneeName: '', consigneeCnpj: '' });
                      const c: any = clients.find((x: any) => x.id === v);
                      patch({
                        consigneeClientId: v,
                        consigneeName: c?.company_name || '',
                        consigneeCnpj: c?.cnpj || '',
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {clients.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="tomador" className="space-y-3 pt-3">
                <Label>Tomador do serviço</Label>
                <RadioGroup value={active.takerRole} onValueChange={(v: any) => patch({ takerRole: v })}>
                  {(['remetente', 'destinatario', 'expedidor', 'recebedor', 'terceiro'] as CteTakerRole[]).map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <RadioGroupItem value={r} id={`taker-${r}`} />
                      <Label htmlFor={`taker-${r}`} className="capitalize font-normal">{r}</Label>
                    </div>
                  ))}
                </RadioGroup>
                {active.takerRole === 'terceiro' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Nome/Razão</Label>
                      <Input value={active.takerName} onChange={(e) => patch({ takerName: e.target.value })} />
                    </div>
                    <div>
                      <Label>CNPJ</Label>
                      <Input value={active.takerCnpj} onChange={(e) => patch({ takerCnpj: e.target.value })} />
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transporte" className="space-y-3 pt-3">
                <div>
                  <Label>Motorista</Label>
                  <Select
                    value={active.driverId || 'none'}
                    onValueChange={(v) => {
                      if (v === 'none') return patch({ driverId: null, driverName: '', driverCpf: '' });
                      const d = drivers.find((x) => x.id === v);
                      patch({ driverId: v, driverName: d?.name || '', driverCpf: d?.cpf || '' });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Nenhum —</SelectItem>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Nome</Label>
                    <Input value={active.driverName} onChange={(e) => patch({ driverName: e.target.value })} />
                  </div>
                  <div>
                    <Label>CPF</Label>
                    <Input value={active.driverCpf} onChange={(e) => patch({ driverCpf: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Veículo</Label>
                  <Select
                    value={active.vehicleId || 'none'}
                    onValueChange={(v) => {
                      if (v === 'none') return patch({ vehicleId: null, vehiclePlate: '' });
                      const veh: any = vehicles.find((x: any) => x.id === v);
                      patch({ vehicleId: v, vehiclePlate: veh?.plate || '' });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Nenhum —</SelectItem>
                      {(vehicles as any[]).map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Placa</Label>
                    <Input value={active.vehiclePlate} onChange={(e) => patch({ vehiclePlate: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input value={active.vehicleState} onChange={(e) => patch({ vehicleState: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>RENAVAM</Label>
                    <Input value={active.vehicleRenavam} onChange={(e) => patch({ vehicleRenavam: e.target.value })} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="carga" className="space-y-3 pt-3">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label>Frete (R$)</Label>
                    <Input type="number" step="0.01" value={active.freightValue}
                      onChange={(e) => patch({ freightValue: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Valor carga (R$)</Label>
                    <Input type="number" step="0.01" value={active.cargoValue}
                      onChange={(e) => patch({ cargoValue: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Peso (kg)</Label>
                    <Input type="number" step="0.001" value={active.weightKg}
                      onChange={(e) => patch({ weightKg: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Pallets</Label>
                    <Input type="number" value={active.palletCount}
                      onChange={(e) => patch({ palletCount: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <Label>NFs referenciadas ({active.invoices.length})</Label>
                  <div className="rounded-md border max-h-[200px] overflow-auto text-xs">
                    {active.invoices.map((n) => (
                      <div key={n.id} className="flex justify-between border-b px-2 py-1 last:border-0">
                        <span className="font-mono">{n.number || '—'} / {n.series || '—'}</span>
                        <span className="font-mono text-muted-foreground truncate max-w-[280px]">{n.access_key || 'sem chave'}</span>
                        <span>R$ {(n.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="fiscal" className="space-y-3 pt-3">
                <div>
                  <Label>Natureza da operação</Label>
                  <Input value={active.nature} onChange={(e) => patch({ nature: e.target.value })} />
                </div>
                <div>
                  <Label>CFOP</Label>
                  <Input value={active.cfop} onChange={(e) => patch({ cfop: e.target.value })} placeholder="ex.: 5353, 6353" />
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea rows={4} value={active.observations} onChange={(e) => patch({ observations: e.target.value })} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <div className="mr-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={activeIdx === 0}
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={activeIdx >= items.length - 1}
              onClick={() => setActiveIdx((i) => Math.min(items.length - 1, i + 1))}
            >
              Próximo <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button disabled={!allValid || transmitting} onClick={transmit}>
            {transmitting ? (
              <><RotateCw className="h-4 w-4 mr-2 animate-spin" /> Transmitindo…</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Transmitir {items.length} CT-e(s)</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}