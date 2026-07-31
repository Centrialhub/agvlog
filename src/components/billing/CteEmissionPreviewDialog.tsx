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
import { buildCtePayload, computeIcmsAmounts, type CteTakerRole, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import type { CteDocType } from '@/lib/fiscal/cteBuilder';
import { suggestIcmsAliquota, icmsIsentoByCst } from '@/lib/fiscal/icmsAliquota';

/** Recalcula base/valor do ICMS respeitando o regime embutido (por dentro). */
function recalcIcms(
  freight: number,
  aliq: number,
  embutido: boolean,
  isento: boolean,
  providedBase?: number | null,
): { base: number; valor: number } {
  return computeIcmsAmounts({
    freight: freight || 0,
    aliq: Number(aliq) || 0,
    embutido,
    isento,
    providedBase: providedBase ?? null,
  });
}

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
  remitterIe: string;
  recipientName: string;
  recipientCnpj: string;
  recipientIe: string;
  recipientCity: string;
  recipientState: string;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeCnpj: string;
  expedidorName: string;
  expedidorCnpj: string;
  recebedorName: string;
  recebedorCnpj: string;
  insurerName: string;
  insurerPolicy: string;
  insurerEndorsement: string;
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
  vehicleType: string;
  trailerPlate1: string;
  trailerPlate2: string;
  trailerPlate3: string;
  documentType: CteDocType;
  refNumber: string;
  clientOrderNumber: string;
  nature: string;
  cfop: string;
  observations: string;
  freightValue: number;
  cargoValue: number;
  weightKg: number;
  palletCount: number;
  // Composição do frete (opcional)
  fcFreightWeight: number;
  fcDeliveryFee: number;
  fcOthers: number;
  fcInsurance: number;
  fcDispatch: number;
  fcGris: number;
  fcToll: number;
  fcTracking: number;
  fcLoading: number;
  fcHelper: number;
  // ICMS
  icmsCst: string;
  icmsEmbutido: boolean;
  icmsIsento: boolean;
  icmsAliquota: number;
  icmsBase: number;
  icmsValor: number;
  // CBS/IBS
  cbsAliquota: number;
  ibsAliquota: number;
  cbsIbsBase: number;
  // Mercadoria
  cargoContent: string;
  cargoSpecies: string;
  cargoPredominant: string;
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
    remitterIe: '',
    recipientName: g.recipient || '',
    recipientCnpj: first?.recipient_cnpj || '',
    recipientIe: '',
    recipientCity: g.recipient_city || '',
    recipientState: g.recipient_state || '',
    consigneeClientId: null,
    consigneeName: '',
    consigneeCnpj: '',
    expedidorName: '',
    expedidorCnpj: '',
    recebedorName: '',
    recebedorCnpj: '',
    insurerName: '',
    insurerPolicy: '',
    insurerEndorsement: '',
    takerRole: 'remetente',
    takerName: '',
    takerCnpj: '',
    driverId: null,
    driverName: '',
    driverCpf: '',
    vehicleId: null,
    vehiclePlate: '',
    vehicleState: '',
    vehicleRenavam: '',
    vehicleType: '01',
    trailerPlate1: '',
    trailerPlate2: '',
    trailerPlate3: '',
    documentType: '01',
    refNumber: '',
    clientOrderNumber: '',
    nature: 'PRESTACAO DE SERVICO DE TRANSPORTE',
    cfop: '',
    observations: '',
    freightValue: g.freight_value,
    cargoValue: g.cargo_value,
    weightKg: g.weight_kg,
    palletCount: g.pallet_count,
    fcFreightWeight: 0,
    fcDeliveryFee: 0,
    fcOthers: 0,
    fcInsurance: 0,
    fcDispatch: 0,
    fcGris: 0,
    fcToll: 0,
    fcTracking: 0,
    fcLoading: 0,
    fcHelper: 0,
    icmsEmbutido: true,
    icmsIsento: false,
    icmsAliquota: 12,
    ...(() => {
      const r = recalcIcms(g.freight_value || 0, 12, true, false);
      return { icmsBase: r.base, icmsValor: r.valor };
    })(),
    icmsCst: '00',
    cbsAliquota: 0.9,
    ibsAliquota: 0.1,
    cbsIbsBase: 0,
    cargoContent: 'CONFORME NF',
    cargoSpecies: 'CONFORME NF',
    cargoPredominant: '',
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
  clients: any[] = [],
): BuildCtePayloadInput {
  const digits = (v?: string | null) => (v || '').replace(/\D+/g, '');
  const byCnpj = new Map<string, any>();
  for (const c of clients) {
    const k = digits(c?.tax_id);
    if (k) byCnpj.set(k, c);
  }
  function addressFromClient(c: any) {
    if (!c) return null;
    return {
      street: c.address_street || null,
      number: c.address_number || null,
      complement: c.address_complement || null,
      neighborhood: c.address_neighborhood || null,
      city: c.address_city || null,
      state: c.address_state || null,
      zip: c.address_zip || null,
    };
  }
  function enrichParty(
    name: string,
    cnpj: string,
    fallbackAddress?: { city?: string | null; state?: string | null } | null,
    ieOverride?: string | null,
  ) {
    if (!name) return null;
    const c = byCnpj.get(digits(cnpj));
    const addr = addressFromClient(c);
    return {
      name,
      cnpj: cnpj || c?.tax_id || null,
      ie: (ieOverride && ieOverride.trim()) || c?.state_registration || null,
      address:
        addr ||
        (fallbackAddress
          ? {
              street: null,
              number: null,
              complement: null,
              neighborhood: null,
              city: fallbackAddress.city || null,
              state: fallbackAddress.state || null,
              zip: null,
            }
          : null),
    };
  }
  return {
    emitter: emitter
      ? {
          id: emitter.id,
          cnpj: emitter.cnpj,
          ie: emitter.ie,
          name: emitter.razao_social || emitter.nome_fantasia || '',
          environment,
          taxRegime: emitter.regime_tributario || null,
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
    remitter: enrichParty(e.remitterName, e.remitterCnpj, null, e.remitterIe),
    recipient: enrichParty(
      e.recipientName,
      e.recipientCnpj,
      { city: e.recipientCity, state: e.recipientState },
      e.recipientIe,
    ),
    consignee: enrichParty(e.consigneeName, e.consigneeCnpj),
    expedidor: enrichParty(e.expedidorName, e.expedidorCnpj),
    recebedor: enrichParty(e.recebedorName, e.recebedorCnpj),
    insurer: e.insurerName
      ? {
          name: e.insurerName,
          policy: e.insurerPolicy || null,
          endorsement: e.insurerEndorsement || null,
        }
      : null,
    takerRole: e.takerRole,
    takerParty:
      e.takerRole === 'terceiro'
        ? enrichParty(e.takerName, e.takerCnpj)
        : null,
    driver: e.driverName ? { id: e.driverId, name: e.driverName, cpf: e.driverCpf } : null,
    vehicle: e.vehiclePlate
      ? { id: e.vehicleId, plate: e.vehiclePlate, state: e.vehicleState, renavam: e.vehicleRenavam }
      : null,
    vehicleType: e.vehicleType || null,
    additionalPlates: [e.trailerPlate1, e.trailerPlate2, e.trailerPlate3].filter(Boolean),
    documentType: e.documentType,
    refNumber: e.refNumber || null,
    clientOrderNumber: e.clientOrderNumber || null,
    freightComposition: {
      freight_weight: e.fcFreightWeight || null,
      delivery_fee: e.fcDeliveryFee || null,
      others: e.fcOthers || null,
      insurance_value: e.fcInsurance || null,
      dispatch: e.fcDispatch || null,
      gris: e.fcGris || null,
      toll: e.fcToll || null,
      tracking: e.fcTracking || null,
      loading: e.fcLoading || null,
      helper: e.fcHelper || null,
    },
    icms: {
      cst: e.icmsCst || null,
      embutido: e.icmsEmbutido,
      isento: e.icmsIsento,
      aliquota: e.icmsAliquota || null,
      base: e.icmsBase || null,
      valor: e.icmsValor || null,
    },
    cbsIbs: {
      base: e.cbsIbsBase || null,
      cbs_aliquota: e.cbsAliquota || null,
      cbs_valor: e.cbsIbsBase && e.cbsAliquota ? Number((e.cbsIbsBase * e.cbsAliquota / 100).toFixed(2)) : null,
      ibs_aliquota: e.ibsAliquota || null,
      ibs_valor: e.cbsIbsBase && e.ibsAliquota ? Number((e.cbsIbsBase * e.ibsAliquota / 100).toFixed(2)) : null,
    },
    cargo: {
      content: e.cargoContent || null,
      species: e.cargoSpecies || null,
      predominant_product: e.cargoPredominant || null,
      items_count: e.invoices.length || null,
    },
    nature: e.nature,
    cfop: e.cfop || null,
    observations: e.observations || null,
    invoices: e.invoices,
    totals: {
      freight_value: e.freightValue,
      cargo_value: e.cargoValue,
      weight_kg: e.weightKg,
      pallet_count: e.palletCount,
      cbs_value: e.cbsIbsBase && e.cbsAliquota ? Number((e.cbsIbsBase * e.cbsAliquota / 100).toFixed(2)) : undefined,
      ibs_value: e.cbsIbsBase && e.ibsAliquota ? Number((e.cbsIbsBase * e.ibsAliquota / 100).toFixed(2)) : undefined,
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
  const [bulkEdit, setBulkEdit] = useState(true);

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
            // Remetente/destinatário dominantes calculados pelo RPC a partir das NFs vinculadas
            remitterName: it.remitterName || d.remitter?.remitter || '',
            remitterCnpj: it.remitterCnpj || d.remitter?.remitter_cnpj || '',
            recipientName: it.recipientName || d.recipient?.recipient || '',
            recipientCnpj: it.recipientCnpj || d.recipient?.recipient_cnpj || '',
            recipientCity: it.recipientCity || d.recipient?.recipient_city || '',
            recipientState: it.recipientState || d.recipient?.recipient_state || '',
            clientId: it.clientId || d.recipient?.client_id || null,
          };
        }),
      );
      setItems(patched);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-preenche IE de remetente/destinatário a partir do cadastro de clientes/fornecedores
  useEffect(() => {
    if (!open || items.length === 0 || clients.length === 0) return;
    const digitsOnly = (v?: string | null) => (v || '').replace(/\D+/g, '');
    const byCnpj = new Map<string, any>();
    for (const c of clients as any[]) {
      const k = digitsOnly(c?.tax_id);
      if (k) byCnpj.set(k, c);
    }
    let changed = false;
    const next = items.map((it) => {
      let out = it;
      if (!out.remitterIe) {
        const c = byCnpj.get(digitsOnly(out.remitterCnpj));
        if (c?.state_registration) {
          out = { ...out, remitterIe: String(c.state_registration) };
          changed = true;
        }
      }
      if (!out.recipientIe) {
        const c = byCnpj.get(digitsOnly(out.recipientCnpj));
        if (c?.state_registration) {
          out = { ...out, recipientIe: String(c.state_registration) };
          changed = true;
        }
      }
      return out;
    });
    if (changed) setItems(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clients, items.length]);

  const active = items[activeIdx];
  const emitterForActive = useMemo(
    () => emitters.find((e: any) => e.id === active?.emitterId) || defaultEmitter,
    [emitters, active?.emitterId, defaultEmitter],
  );

  // Auto-sugere alíquota de ICMS conforme UF de origem (emitente) e destino (destinatário) quando ainda não editada.
  useEffect(() => {
    if (!active) return;
    const originUf = (emitterForActive as any)?.endereco?.uf || null;
    const destUf = active.recipientState || null;
    if (!originUf || !destUf) return;
    const isento = icmsIsentoByCst(active.icmsCst);
    const suggested = isento ? 0 : suggestIcmsAliquota(originUf, destUf);
    if (Math.abs(active.icmsAliquota - suggested) < 0.001) return;
    const r = recalcIcms(active.freightValue || 0, suggested, active.icmsEmbutido, isento);
    setItems((prev) =>
      prev.map((it, i) =>
        i === activeIdx
          ? {
              ...it,
              icmsAliquota: suggested,
              icmsBase: r.base,
              icmsValor: r.valor,
            }
          : it,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, active?.recipientState, active?.icmsCst, emitterForActive?.id]);

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
    const r = buildCtePayload(toBuildInput(active, emitterForActive, activeEnvironment, clients));
    return { ok: r.ok, missing: r.missing, warnings: r.warnings };
  }, [active, emitterForActive, activeEnvironment, clients]);

  const allValid = items.every((it) => {
    const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
    return buildCtePayload(toBuildInput(it, em, 'sandbox', clients)).ok;
  });

  function patch(patch: Partial<EditableCte>) {
    // Chaves específicas de cada CT-e — nunca replicar para o lote.
    const PER_ITEM_ONLY = new Set<keyof EditableCte>([
      'remitterName', 'remitterCnpj', 'remitterIe',
      'recipientName', 'recipientCnpj', 'recipientIe',
      'recipientCity', 'recipientState',
      'consigneeClientId', 'consigneeName', 'consigneeCnpj',
      'expedidorName', 'expedidorCnpj',
      'recebedorName', 'recebedorCnpj',
      'refNumber', 'clientOrderNumber',
      'freightValue', 'cargoValue', 'weightKg', 'palletCount',
      'icmsBase', 'icmsValor', 'cbsIbsBase',
      'fcFreightWeight',
      'invoices', 'loadIds', 'fiscalDocumentIds', 'clientId',
      'key', 'transmitted', 'transmitMessage',
    ]);
    if (!bulkEdit) {
      setItems((arr) => arr.map((it, i) => (i === activeIdx ? { ...it, ...patch } : it)));
      return;
    }
    // Separa o patch em duas partes: bulk-safe e per-item.
    const bulkPart: Record<string, any> = {};
    const activePart: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (PER_ITEM_ONLY.has(k as keyof EditableCte)) activePart[k] = v;
      else bulkPart[k] = v;
    }
    setItems((arr) =>
      arr.map((it, i) => {
        const base = { ...it, ...bulkPart };
        return i === activeIdx ? { ...base, ...activePart } : base;
      }),
    );
  }

  async function transmit() {
    setTransmitting(true);
    let okCount = 0;
    const errors: string[] = [];
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
            ...toBuildInput(it, em, itEnv, clients),
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
          okCount++;
        } catch (err: any) {
          setItems((arr) =>
            arr.map((x, idx) =>
              idx === i ? { ...x, transmitted: 'error', transmitMessage: err?.message } : x,
            ),
          );
          errors.push(`#${i + 1}: ${err?.message || 'erro desconhecido'}`);
        }
      }
      if (okCount === 0) {
        toast.error('Nenhum CT-e chegou ao Hub Fiscal', {
          description: errors.slice(0, 3).join(' • ') || 'Verifique credenciais do emitente.',
          duration: 10000,
        });
      } else if (errors.length > 0) {
        toast.warning(`${okCount} CT-e(s) transmitidos, ${errors.length} com erro`, {
          description: errors.slice(0, 3).join(' • '),
          duration: 10000,
        });
      } else {
        toast.success(`${okCount} CT-e(s) transmitidos ao Hub Fiscal.`);
      }
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

        <div className="flex items-center gap-2 text-xs">
          <Badge variant={activeEnvironment === 'production' ? 'default' : 'secondary'}>
            {activeEnvironment === 'production' ? 'PRODUÇÃO' : 'SANDBOX'}
          </Badge>
          {!activeCteCred && emitterForActive && (
            <Badge variant="destructive">
              Sem credencial CT-e — usará token padrão (risco)
            </Badge>
          )}
          {activeCteCred && (
            <span className="text-muted-foreground">
              scope: {activeCteCred.doc_scope} · env: {activeCteCred.environment}
            </span>
          )}
          <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={bulkEdit}
              onChange={(e) => setBulkEdit(e.target.checked)}
              className="h-3 w-3"
            />
            <span className={bulkEdit ? 'font-medium' : 'text-muted-foreground'}>
              Aplicar edições a todas as {items.length} CT-es do lote
            </span>
          </label>
        </div>

        <div className="grid grid-cols-[220px_1fr] gap-4">
          {/* Navegação entre CT-es */}
          <ScrollArea className="h-[540px] rounded-md border p-2">
            <div className="space-y-1">
              {items.map((it, i) => {
                const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
                const ok = buildCtePayload(toBuildInput(it, em, 'sandbox', clients)).ok;
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
                    {it.invoices.length > 0 && (
                      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={it.invoices.map((n: any) => n.number || '—').join(', ')}>
                        NF: {it.invoices.map((n: any) => n.number || '—').join(', ')}
                      </div>
                    )}
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
                  <div>
                    <Label>IE remetente</Label>
                    <Input
                      value={active.remitterIe}
                      onChange={(e) => patch({ remitterIe: e.target.value })}
                      placeholder="ISENTO se não contribuinte"
                    />
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
                    <Label>IE destinatário</Label>
                    <Input
                      value={active.recipientIe}
                      onChange={(e) => patch({ recipientIe: e.target.value })}
                      placeholder="ISENTO se não contribuinte"
                    />
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
                <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                  <div>
                    <Label>Expedidor (opcional)</Label>
                    <Input value={active.expedidorName} onChange={(e) => patch({ expedidorName: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ expedidor</Label>
                    <Input value={active.expedidorCnpj} onChange={(e) => patch({ expedidorCnpj: e.target.value })} />
                  </div>
                  <div>
                    <Label>Recebedor (opcional)</Label>
                    <Input value={active.recebedorName} onChange={(e) => patch({ recebedorName: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ recebedor</Label>
                    <Input value={active.recebedorCnpj} onChange={(e) => patch({ recebedorCnpj: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div>
                    <Label>Seguradora</Label>
                    <Input value={active.insurerName} onChange={(e) => patch({ insurerName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Apólice</Label>
                    <Input value={active.insurerPolicy} onChange={(e) => patch({ insurerPolicy: e.target.value })} />
                  </div>
                  <div>
                    <Label>Nº averbação</Label>
                    <Input value={active.insurerEndorsement} onChange={(e) => patch({ insurerEndorsement: e.target.value })} />
                  </div>
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
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Tipo CT-e</Label>
                    <Select value={active.documentType} onValueChange={(v: any) => patch({ documentType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="01">01 — Normal</SelectItem>
                        <SelectItem value="02">02 — Complementar</SelectItem>
                        <SelectItem value="03">03 — Anulação</SelectItem>
                        <SelectItem value="04">04 — Substituição</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Nº Ref</Label>
                    <Input value={active.refNumber} onChange={(e) => patch({ refNumber: e.target.value })} />
                  </div>
                  <div>
                    <Label>Nº Pedido Cliente</Label>
                    <Input value={active.clientOrderNumber} onChange={(e) => patch({ clientOrderNumber: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Motorista</Label>
                  {!active.driverName && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Emissão com "."</Badge>
                  )}
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
                  {!active.vehiclePlate && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Emissão com "."</Badge>
                  )}
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
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label>Tipo veículo</Label>
                    <Input value={active.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value })} placeholder="01" />
                  </div>
                  <div>
                    <Label>Carreta 1</Label>
                    <Input value={active.trailerPlate1} onChange={(e) => patch({ trailerPlate1: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>Carreta 2</Label>
                    <Input value={active.trailerPlate2} onChange={(e) => patch({ trailerPlate2: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>Carreta 3</Label>
                    <Input value={active.trailerPlate3} onChange={(e) => patch({ trailerPlate3: e.target.value.toUpperCase() })} />
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
                <div className="pt-2 border-t">
                  <Label className="text-xs font-semibold">Mercadoria</Label>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <Label className="text-xs">Conteúdo</Label>
                      <Input value={active.cargoContent} onChange={(e) => patch({ cargoContent: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Espécie</Label>
                      <Input value={active.cargoSpecies} onChange={(e) => patch({ cargoSpecies: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Produto predominante</Label>
                      <Input value={active.cargoPredominant} onChange={(e) => patch({ cargoPredominant: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <Label className="text-xs font-semibold">Composição do frete (opcional)</Label>
                  <div className="grid grid-cols-5 gap-2 pt-1">
                    {[
                      ['fcFreightWeight', 'Frete peso'],
                      ['fcDeliveryFee', 'Valor entrega'],
                      ['fcOthers', 'Outros'],
                      ['fcInsurance', 'Seguro (R$)'],
                      ['fcDispatch', 'Despacho'],
                      ['fcGris', 'GRIS'],
                      ['fcToll', 'Pedágio'],
                      ['fcTracking', 'Rastreamento'],
                      ['fcLoading', 'Carga/Descarga'],
                      ['fcHelper', 'Ajudante'],
                    ].map(([k, label]) => (
                      <div key={k}>
                        <Label className="text-xs">{label}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(active as any)[k]}
                          onChange={(e) => patch({ [k]: Number(e.target.value) } as any)}
                        />
                      </div>
                    ))}
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
                <div className="pt-2 border-t">
                  <Label className="text-xs font-semibold">ICMS</Label>
                  <div className="grid grid-cols-6 gap-2 pt-1 items-end">
                    <div>
                      <Label className="text-xs">CST</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={active.icmsCst}
                        onChange={(e) => {
                          const cst = e.target.value;
                          const isento = icmsIsentoByCst(cst);
                          const originUf = (emitterForActive as any)?.endereco?.uf || null;
                          const aliq = isento ? 0 : suggestIcmsAliquota(originUf, active.recipientState);
                          const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, isento);
                          patch({
                            icmsCst: cst,
                            icmsIsento: isento,
                            icmsAliquota: aliq,
                            icmsBase: r.base,
                            icmsValor: r.valor,
                          });
                        }}
                      >
                        <option value="00">00 — Tributação normal</option>
                        <option value="20">20 — Redução de base</option>
                        <option value="40">40 — Isenta</option>
                        <option value="41">41 — Não tributada</option>
                        <option value="51">51 — Diferimento</option>
                        <option value="60">60 — ICMS cobrado por ST</option>
                        <option value="90">90 — Outros</option>
                        <option value="SN">90 CSOSN — Simples Nacional</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={active.icmsEmbutido}
                        onChange={(e) => {
                          const embutido = e.target.checked;
                          const r = recalcIcms(active.freightValue || 0, active.icmsAliquota, embutido, active.icmsIsento);
                          patch({ icmsEmbutido: embutido, icmsBase: r.base, icmsValor: r.valor });
                        }}
                      />
                      Embutido
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={active.icmsIsento}
                        onChange={(e) => {
                          const isento = e.target.checked;
                          const r = recalcIcms(active.freightValue || 0, active.icmsAliquota, active.icmsEmbutido, isento);
                          patch({ icmsIsento: isento, icmsBase: r.base, icmsValor: r.valor });
                        }}
                      />
                      Isento
                    </label>
                    <div>
                      <Label className="text-xs">Alíquota %</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={active.icmsAliquota}
                        onChange={(e) => {
                          const aliq = Number(e.target.value);
                          const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, active.icmsIsento);
                          patch({
                            icmsAliquota: aliq,
                            icmsBase: r.base,
                            icmsValor: r.valor,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Base</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={active.icmsBase}
                        onChange={(e) => {
                          const base = Number(e.target.value);
                          // Base manual: usuário assume a base e o valor sai por fora.
                          patch({
                            icmsBase: base,
                            icmsValor: Number((base * (active.icmsAliquota || 0) / 100).toFixed(2)),
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Valor</Label>
                      <Input type="number" step="0.01" value={active.icmsValor} onChange={(e) => patch({ icmsValor: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-muted-foreground">
                      Sugestão automática por UF origem/destino. Interestadual S/SE→N/NE/CO/ES = 7%, demais = 12%; intraestadual usa tabela por UF.
                      {' '}Com <b>Embutido</b> marcado, a base é calculada por dentro: base = frete / (1 − alíq/100).
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const originUf = (emitterForActive as any)?.endereco?.uf || null;
                        const isento = icmsIsentoByCst(active.icmsCst);
                        const aliq = isento ? 0 : suggestIcmsAliquota(originUf, active.recipientState);
                        const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, isento);
                        patch({
                          icmsAliquota: aliq,
                          icmsBase: r.base,
                          icmsValor: r.valor,
                        });
                      }}
                    >
                      Recalcular
                    </Button>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <Label className="text-xs font-semibold">Reforma tributária (CBS/IBS)</Label>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <Label className="text-xs">Base (R$)</Label>
                      <Input type="number" step="0.01" value={active.cbsIbsBase} onChange={(e) => patch({ cbsIbsBase: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-xs">CBS % (padrão 0,90)</Label>
                      <Input type="number" step="0.01" value={active.cbsAliquota} onChange={(e) => patch({ cbsAliquota: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-xs">IBS % (padrão 0,10)</Label>
                      <Input type="number" step="0.01" value={active.ibsAliquota} onChange={(e) => patch({ ibsAliquota: Number(e.target.value) })} />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-1">
                    CBS ={' '}
                    R$ {((active.cbsIbsBase * active.cbsAliquota) / 100).toFixed(2)} · IBS ={' '}
                    R$ {((active.cbsIbsBase * active.ibsAliquota) / 100).toFixed(2)}
                  </p>
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