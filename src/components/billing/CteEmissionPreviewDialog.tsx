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
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/integrations/supabase/client';
import { useEmitters } from '@/hooks/useEmitters';
import { useHubCredentials } from '@/hooks/useEmitters';
import { useVehicles } from '@/hooks/useVehicles';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { useIssueCTe } from '@/hooks/useIssueCTe';
import { useInsuranceProfile, useUpdateInsuranceProfile } from '@/hooks/useInsuranceProfile';
import { useAlertStore } from '@/hooks/useAlertStore';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';
import { buildCtePayload, computeIcmsAmounts, type CteTakerRole, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import type { CteDocType } from '@/lib/fiscal/cteBuilder';
import { suggestIcmsAliquota, icmsIsentoByCst } from '@/lib/fiscal/icmsAliquota';
import { validateInsurance, formatCnpj, onlyDigits } from '@/lib/fiscal/insuranceValidation';
import {
  applyInsuranceProfileToBatch,
  hasInsuranceProfile,
  preserveInsurerFields,
} from '@/lib/fiscal/insuranceProfile';
import {
  buildClientIndex,
  fillPartyFieldsFromRegistry,
  resolveParty,
} from '@/lib/fiscal/partyRegistry';

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
  remitterStreet: string;
  remitterNumber: string;
  remitterNeighborhood: string;
  remitterZip: string;
  recipientName: string;
  recipientCnpj: string;
  recipientIe: string;
  recipientCity: string;
  recipientState: string;
  recipientStreet: string;
  recipientNumber: string;
  recipientNeighborhood: string;
  recipientZip: string;
  recipientCityIbge: string;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeCnpj: string;
  expedidorName: string;
  expedidorCnpj: string;
  recebedorName: string;
  recebedorCnpj: string;
  insurerName: string;
  insurerCnpj: string;
  insurerPolicy: string;
  insurerEndorsement: string;
  insurerInsuredAmount: number;
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
  _aliqManual?: boolean;
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
    remitterStreet: '',
    remitterNumber: '',
    remitterNeighborhood: '',
    remitterZip: '',
    recipientName: g.recipient || '',
    recipientCnpj: first?.recipient_cnpj || '',
    recipientIe: '',
    recipientCity: g.recipient_city || '',
    recipientState: g.recipient_state || '',
    recipientStreet: '',
    recipientNumber: '',
    recipientNeighborhood: '',
    recipientZip: '',
    recipientCityIbge: '',

    consigneeClientId: null,
    consigneeName: '',
    consigneeCnpj: '',
    expedidorName: '',
    expedidorCnpj: '',
    recebedorName: '',
    recebedorCnpj: '',
    insurerName: '',
    insurerCnpj: '',
    insurerPolicy: '',
    insurerEndorsement: '',
    insurerInsuredAmount: 0,
    takerRole: 'remetente',
    takerName: g.remitter || '',
    takerCnpj: first?.remitter_cnpj || '',
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
    icmsAliquota: 0,
    icmsBase: 0,
    icmsValor: 0,
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
  // Completa lacunas das partes com o cadastro local (CNPJ, IE, endereço).
  const registry = buildClientIndex(clients as any[]);
  const enrichParty = (
    name: string,
    cnpj: string,
    fallbackAddress?: { 
      city?: string | null; 
      state?: string | null;
      street?: string | null;
      number?: string | null;
      neighborhood?: string | null;
      zip?: string | null;
    } | null,
    ieOverride?: string | null,
    clientId?: string | null,
  ) =>
    resolveParty(registry, { id: clientId, name, cnpj, ie: ieOverride }, fallbackAddress);
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
    remitter: enrichParty(e.remitterName, e.remitterCnpj, {
      street: e.remitterStreet || null,
      number: e.remitterNumber || null,
      neighborhood: e.remitterNeighborhood || null,
      zip: e.remitterZip || null
    }, e.remitterIe),
    recipient: enrichParty(
      e.recipientName,
      e.recipientCnpj,
      { 
        city: e.recipientCity, 
        state: e.recipientState,
        street: e.recipientStreet || null,
        number: e.recipientNumber || null,
        neighborhood: e.recipientNeighborhood || null,
        zip: e.recipientZip || null,
        city_ibge: e.recipientCityIbge || null
      } as any,
      e.recipientIe,
      e.clientId,
    ),
    overrides: {
      remitter: (e.remitterStreet || e.remitterNumber || e.remitterNeighborhood || e.remitterZip || e.remitterCnpj || e.remitterIe || e.remitterName) ? {
        name: e.remitterName || null,
        cnpj: e.remitterCnpj || null,
        ie: e.remitterIe || null,
        address: {
          street: e.remitterStreet || null,
          number: e.remitterNumber || null,
          neighborhood: e.remitterNeighborhood || null,
          zip: e.remitterZip || null
        } as any
      } : null,
      recipient: (e.recipientStreet || e.recipientNumber || e.recipientNeighborhood || e.recipientZip || e.recipientCnpj || e.recipientIe || e.recipientCityIbge || e.recipientCity || e.recipientState || e.recipientName) ? {
        name: e.recipientName || null,
        cnpj: e.recipientCnpj || null,
        ie: e.recipientIe || null,
        address: {
          street: e.recipientStreet || null,
          number: e.recipientNumber || null,
          neighborhood: e.recipientNeighborhood || null,
          zip: e.recipientZip || null,
          city: e.recipientCity || null,
          state: e.recipientState || null,
          city_ibge: e.recipientCityIbge || null
        } as any
      } : null,
    },

    consignee: enrichParty(e.consigneeName, e.consigneeCnpj, null, null, e.consigneeClientId),
    expedidor: enrichParty(e.expedidorName, e.expedidorCnpj),
    recebedor: enrichParty(e.recebedorName, e.recebedorCnpj),
    insurer: e.insurerName
      ? {
          name: e.insurerName,
          cnpj: e.insurerCnpj || null,
          policy: e.insurerPolicy || null,
          endorsement: e.insurerEndorsement || null,
          insured_amount: e.insurerInsuredAmount || e.cargoValue || null,
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
    // RNTRC: o Hub usa o cadastro da empresa, mas enviamos quando disponível localmente.
    rntrc: emitter?.rntrc || emitter?.endereco?.rntrc || null,
    // Início / fim da prestação (override de UFIni/UFFim). Início = remetente
    // (o builder cai no endereço do emitente quando o remetente não tem UF).
    origin: null,
    destination: e.recipientCityIbge || e.recipientCity || e.recipientState
      ? { 
          city: e.recipientCity || null, 
          state: e.recipientState || null,
          city_ibge: e.recipientCityIbge || null
        }
      : null,
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
  const { data: insuranceProfile } = useInsuranceProfile();
  const saveInsuranceProfile = useUpdateInsuranceProfile();

  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [items, setItems] = useState<EditableCte[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [transmitting, setTransmitting] = useState(false);
  const [bulkEditPartes, setBulkEditPartes] = useState(false);
  const [bulkEditTomador, setBulkEditTomador] = useState(false);
  const [bulkEditTransporte, setBulkEditTransporte] = useState(false);
  const [bulkEditCarga, setBulkEditCarga] = useState(false);
  const [bulkEditFiscal, setBulkEditFiscal] = useState(true);
  
  const bulkEdit = useMemo(() => {
    // Para retrocompatibilidade com a lógica de patch(), mas agora baseada na aba ativa.
    return true; // Sempre tentamos aplicar bulk, a lógica de filtro está no patch()
  }, []);
  const { showAlert } = useAlertStore();

  const defaultEmitter = emitters.find((e: any) => e.is_default && e.active) || emitters[0];

  // Assinatura do lote: muda sempre que as notas/grupos selecionados mudam.
  // Sem isso o diálogo mantinha o lote capturado na primeira abertura (bug:
  // abrir a prévia antes de selecionar as notas transmitia todas as elegíveis).
  const groupsSignature = useMemo(
    () => groups.map((g) => `${g.key}:${(g.fiscal_document_ids || []).join('.')}`).join('|'),
    [groups],
  );

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

  // Inicializa sempre a partir do lote atual e então pré-preenche via RPC.
  // A consulta anterior é descartada quando a seleção muda, evitando que uma
  // resposta tardia restaure no modal as notas do lote anterior.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const registry = clients.length > 0 ? buildClientIndex(clients as any[]) : null;
    
    const baseItems = groups.map((g) => {
      const it = groupToEditable(g, defaultEmitter?.id || '');
      // Pré-preenche com o cadastro se disponível
      if (registry) {
        return fillPartyFieldsFromRegistry(it, registry).item;
      }
      return it;
    });

    setItems(baseItems);
    setActiveIdx(0);

    if (baseItems.length === 0) return () => { cancelled = true; };

    (async () => {
      const patched = await Promise.all(
        baseItems.map(async (it) => {
          if (it.loadIds.length === 0) return it;
          const { data } = await (supabase as any).rpc('cte_defaults_for_group', {
            p_load_ids: it.loadIds,
          });
          if (!data) return it;
          const d: any = data;
          
          let updated = {
            ...it,
            driverId: it.driverId || d.driver?.id || null,
            driverName: it.driverName || d.driver?.name || '',
            driverCpf: it.driverCpf || d.driver?.cpf || '',
            vehicleId: it.vehicleId || d.vehicle?.id || null,
            vehiclePlate: it.vehiclePlate || d.vehicle?.plate || '',
            vehicleState: it.vehicleState || d.vehicle?.state || '',
            vehicleRenavam: it.vehicleRenavam || d.vehicle?.renavam || '',
            emitterId: it.emitterId || d.emitter?.id || '',
            nature: it.nature || d.nature_default || 'PRESTACAO DE SERVICO DE TRANSPORTE',
            remitterName: it.remitterName || d.remitter?.remitter || '',
            remitterCnpj: it.remitterCnpj || d.remitter?.remitter_cnpj || '',
            recipientName: it.recipientName || d.recipient?.recipient || '',
            recipientCnpj: it.recipientCnpj || d.recipient?.recipient_cnpj || '',
            recipientCity: it.recipientCity || d.recipient?.recipient_city || '',
            recipientState: it.recipientState || d.recipient?.recipient_state || '',
            clientId: it.clientId || d.recipient?.client_id || null,
            cargoPredominant: it.cargoPredominant || d.cargo_predominant || '',
          };

          // Após o RPC, tenta preencher lacunas de endereço/IE com o cadastro novamente
          if (registry) {
            updated = fillPartyFieldsFromRegistry(updated, registry).item;
          }

          return updated;
        }),
      );
      if (cancelled) return;
      setItems((prev) => {
        const previousByKey = new Map(prev.map((it) => [it.key, it]));
        return patched.map((it) => {
          const previous = previousByKey.get(it.key);
          return previous ? preserveInsurerFields(previous, it) : it;
        });
      });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupsSignature, defaultEmitter?.id, clients.length]);

  // Aplica a seguradora padrão salva em todos os CT-es do lote. O CNPJ da
  // seguradora também é usado como Nº de averbação/CGC quando o campo está vazio.
  useEffect(() => {
    if (!open || !hasInsuranceProfile(insuranceProfile)) return;
    setItems((prev) => {
      if (prev.length === 0) return prev;
      const { items: next, changed } = applyInsuranceProfileToBatch(prev, insuranceProfile);
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    insuranceProfile,
    items.length,
    // Reaplica sempre que algum CT-e do lote estiver sem seguradora/CNPJ/apólice
    // (ex.: itens repopulados pelo RPC assíncrono ou troca de lote).
    items.some(
      (it) =>
        !it.insurerName ||
        !it.insurerCnpj ||
        !it.insurerPolicy
    ),
  ]);

  // Auto-preenche nome, CNPJ, IE, cidade e UF de remetente/destinatário a partir
  // do cadastro local (clientes/fornecedores) quando a NF veio incompleta.
  useEffect(() => {
    if (!open || items.length === 0 || clients.length === 0) return;
    const registry = buildClientIndex(clients as any[]);
    let changed = false;
    const next = items.map((it) => {
      const r = fillPartyFieldsFromRegistry(it, registry);
      if (r.changed) changed = true;
      return r.item;
    });
    if (changed) setItems(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    clients,
    items.length,
    // Reaplica quando itens são repopulados pelo RPC assíncrono e ficam sem dados.
    items.some(
      (it) =>
        !it.remitterCnpj || !it.remitterIe || !it.recipientCnpj || !it.recipientIe ||
        !it.recipientCity || !it.recipientState,
    ),
  ]);

  const active = items[activeIdx];
  const emitterForActive = useMemo(
    () => emitters.find((e: any) => e.id === active?.emitterId) || defaultEmitter,
    [emitters, active?.emitterId, defaultEmitter],
  );

  // Auto-sugere alíquota de ICMS conforme UF de origem (emitente) e destino (destinatário) quando ainda não editada.
  useEffect(() => {
    if (!active) return;
    
    // Se a alíquota já foi alterada manualmente, ou se o emitente for Simples Nacional (trava em 0), não auto-sugere mais.
    const regime = (emitterForActive as any)?.regime_tributario;
    const isSimples = regime === 'simples' || regime === 'mei';
    if ((active as any)._aliqManual || isSimples) {
      // Se for Simples Nacional e os valores não estiverem zerados, força o zeramento
      if (isSimples && (active.icmsAliquota !== 0 || active.icmsBase !== 0 || active.icmsValor !== 0)) {
        console.log(`[CteEmissionPreviewDialog] Regra aplicada: zerando ICMS para emissor Simples Nacional (${(emitterForActive as any)?.razao_social})`);
        setItems(prev => prev.map((it, i) => {
          if (i === activeIdx || (bulkEdit && !it._aliqManual)) {
             return { ...it, icmsAliquota: 0, icmsBase: 0, icmsValor: 0, icmsIsento: true, icmsCst: '90' };
          }
          return it;
        }));
      }
      return;
    }

    const originUf = (emitterForActive as any)?.endereco?.uf || null;
    const destUf = active.recipientState || null;
    if (!originUf || !destUf) return;
    
    const isento = icmsIsentoByCst(active.icmsCst);
    const suggested = isento ? 0 : suggestIcmsAliquota(originUf, destUf);
    
    if (Math.abs(active.icmsAliquota - suggested) < 0.001) return;
    
    const r = recalcIcms(active.freightValue || 0, suggested, active.icmsEmbutido, isento);
    setItems((prev) =>
      prev.map((it, i) => {
        // Se bulkEdit estiver ligado, aplica a sugestão a todos que NÃO tiverem trava manual
        // ou aplica apenas ao ativo se bulkEdit estiver desligado.
        const shouldUpdate = bulkEdit ? !it._aliqManual : i === activeIdx;
        
        if (shouldUpdate) {
          // Recalcula o ICMS para cada item do lote se for bulk, pois o frete varia
          const itemR = bulkEdit 
            ? recalcIcms(it.freightValue || 0, suggested, it.icmsEmbutido, isento)
            : r;

          return {
            ...it,
            icmsAliquota: suggested,
            icmsBase: itemR.base,
            icmsValor: itemR.valor,
          };
        }
        return it;
      }),
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
    if (!active) return { ok: false, missing: [] as string[], warnings: [] as string[], consistencyError: false };
    const em = emitters.find((e: any) => e.id === active.emitterId) || defaultEmitter;
    const input = toBuildInput(active, em, activeEnvironment, clients);
    const r = buildCtePayload(input);
    
    // Verificação de consistência Builder vs UI (especialmente para Simples Nacional)
    const payloadIcms = (r.payload as any)?.icms || {};
    const regime = (em as any)?.regime_tributario;
    const isSimples = regime === 'simples' || regime === 'mei';
    
    // Se for Simples Nacional, o builder sempre gera 0. A UI deve refletir isso.
    const hasMismatch = isSimples && (
      active.icmsAliquota !== 0 || 
      active.icmsBase !== 0 || 
      active.icmsValor !== 0 ||
      (payloadIcms.vICMS !== 0 && payloadIcms.vICMS !== undefined)
    );

    return { 
      ok: r.ok && !hasMismatch, 
      missing: r.missing, 
      warnings: r.warnings,
      consistencyError: hasMismatch
    };
  }, [active, emitters, defaultEmitter, activeEnvironment, clients]);

  const allValid = items.every((it) => {
    const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
    const input = toBuildInput(it, em, 'sandbox', clients);
    const r = buildCtePayload(input);
    
    const regime = (em as any)?.regime_tributario;
    const isSimples = regime === 'simples' || regime === 'mei';
    const hasMismatch = isSimples && (it.icmsAliquota !== 0 || it.icmsBase !== 0 || it.icmsValor !== 0);
    
    return r.ok && !hasMismatch;
  });

  const insuranceErrors = useMemo(
    () =>
      active
        ? validateInsurance({
            name: active.insurerName,
            cnpj: active.insurerCnpj,
            policy: active.insurerPolicy,
            endorsement: active.insurerEndorsement,
          }).errors
        : {},
    [active],
  );

  function patch(patch: Partial<EditableCte>, tabScope?: 'partes' | 'tomador' | 'transporte' | 'carga' | 'fiscal') {
    // Chaves específicas de cada CT-e que NUNCA devem ser replicadas.
    const PER_ITEM_ONLY = new Set<keyof EditableCte>([
      'key', 'transmitted', 'transmitMessage',
      'invoices', 'loadIds', 'fiscalDocumentIds',
      '_aliqManual',
    ]);

    // Define se a edição atual deve ser replicada para o lote baseada na aba ativa
    let shouldBulk = false;
    if (tabScope === 'partes') shouldBulk = bulkEditPartes;
    else if (tabScope === 'tomador') shouldBulk = bulkEditTomador;
    else if (tabScope === 'transporte') shouldBulk = bulkEditTransporte;
    else if (tabScope === 'carga') shouldBulk = bulkEditCarga;
    else if (tabScope === 'fiscal') shouldBulk = bulkEditFiscal;

    if (!shouldBulk) {
      setItems((arr) => arr.map((it, i) => (i === activeIdx ? { ...it, ...patch } : it)));
      return;
    }

    // Separa o patch em duas partes: bulk-safe e per-item.
    const bulkPart: Record<string, any> = {};
    const activePart: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === '_aliqManual') {
        activePart[k] = v;
        bulkPart[k] = v;
      } else if (PER_ITEM_ONLY.has(k as keyof EditableCte)) {
        activePart[k] = v;
      } else {
        bulkPart[k] = v;
      }
    }
    setItems((arr) =>
      arr.map((it, i) => {
        const base = { ...it, ...bulkPart };
        return i === activeIdx ? { ...base, ...activePart } : base;
      }),
    );
  }

  async function transmit(forcedItems?: EditableCte[]) {
    const itemsToTransmit = forcedItems || items;
    setTransmitting(true);
    let okCount = 0;
    const errors: string[] = [];
    
    // Cache de credenciais por emitente para evitar lookups repetitivos
    const credsCache: Record<string, { env: 'sandbox' | 'production' }> = {};

    try {
      // Processamento em lote com limite de concorrência (5)
      const CONCURRENCY_LIMIT = 5;
      const executing = new Set<Promise<void>>();
      
      for (let i = 0; i < itemsToTransmit.length; i++) {
        const it = itemsToTransmit[i];
        
        const task = (async () => {
          try {
            const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
            
            // Resolve ambiente (cacheado)
            if (!credsCache[it.emitterId]) {
              const { data: itCreds } = await supabase
                .from('hub_fiscal_credentials')
                .select('doc_scope, environment, enabled')
                .eq('emitter_id', it.emitterId)
                .eq('enabled', true);
                
              const itCred =
                (itCreds || []).find((c: any) => c.doc_scope === 'cte') ||
                (itCreds || []).find((c: any) => c.doc_scope === 'all') ||
                null;
                
              credsCache[it.emitterId] = {
                env: itCred?.environment === 'production' ? 'production' : 'sandbox'
              };
            }

            const itEnv = credsCache[it.emitterId].env;

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
              arr.map((x) => (x.key === it.key ? { ...x, transmitted: 'ok' } : x)),
            );
            okCount++;
          } catch (err: any) {
            setItems((arr) =>
              arr.map((x) =>
                x.key === it.key ? { ...x, transmitted: 'error', transmitMessage: err?.message } : x,
              ),
            );
            errors.push(`#${i + 1}: ${err?.message || 'erro desconhecido'}`);
          }
        })();

        executing.add(task);
        task.finally(() => executing.delete(task));

        if (executing.size >= CONCURRENCY_LIMIT) {
          await Promise.race(executing);
        }
      }
      
      // Aguarda as últimas tarefas
      await Promise.all(executing);

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

  function handleTransmitClick() {
    const sameCityItems = items.filter((it) => {
      const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
      const emitterCity = (em?.endereco?.municipio || "").toLowerCase().trim();
      const destCity = (it.recipientCity || "").toLowerCase().trim();
      return emitterCity && destCity && emitterCity === destCity;
    });

    if (sameCityItems.length > 0) {
      const sameCityNames = sameCityItems
        .map((it) => it.recipientName || it.recipientCnpj)
        .join(", ");

      showAlert(
        "Atenção: Destino igual ao Emitente",
        `As seguintes notas têm destino para a mesma cidade do emitente: ${sameCityNames}. Deseja prosseguir?`,
        "warning",
        {
          confirmLabel: "Continuar (emitir todas)",
          secondaryLabel: "Ignorar notas da cidade do emitente",
          cancelLabel: "Cancelar emissão",
          onConfirm: () => transmit(),
          onSecondaryConfirm: () => {
            const filtered = items.filter((it) => !sameCityItems.includes(it));
            if (filtered.length > 0) {
              transmit(filtered);
            } else {
              toast.info("Nenhuma nota restante para emitir.");
            }
          },
        }
      );
      return;
    }

    transmit();
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
          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground italic">
            Configurações de lote por aba (checkbox abaixo)
          </div>
        </div>

        <div className="grid grid-cols-[220px_1fr] gap-4">
          {/* Navegação entre CT-es */}
          <ScrollArea className="h-[540px] rounded-md border p-2">
            <div className="space-y-1">
              {items.map((it, i) => {
                const em = emitters.find((e: any) => e.id === it.emitterId) || defaultEmitter;
                const regime = (em as any)?.regime_tributario;
                const isSimples = regime === 'simples' || regime === 'mei';
                const hasMismatch = isSimples && (it.icmsAliquota !== 0 || it.icmsBase !== 0 || it.icmsValor !== 0);
                const ok = buildCtePayload(toBuildInput(it, em, 'sandbox', clients)).ok && !hasMismatch;
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
            {validation.consistencyError && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Erro de consistência (Regra Simples Nacional):</strong> O ICMS não está zerado para este emitente. 
                  Clique em "Recalcular" na aba Fiscal ou corrija manualmente para prosseguir.
                </AlertDescription>
              </Alert>
            )}
            {!validation.ok && !validation.consistencyError && (
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
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Identificação & Endereços</div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={bulkEditPartes}
                      onChange={(e) => setBulkEditPartes(e.target.checked)}
                      className="h-3 w-3"
                    />
                    <span className={bulkEditPartes ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      Replicar dados desta aba para o lote
                    </span>
                  </label>
                </div>
                <div>
                  <Label>Emitente</Label>
                  <Select value={active.emitterId} onValueChange={(v) => patch({ emitterId: v }, 'partes')}>
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
                    <Input value={active.remitterName} onChange={(e) => patch({ remitterName: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input value={active.remitterCnpj} onChange={(e) => patch({ remitterCnpj: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>IE remetente</Label>
                    <Input
                      value={active.remitterIe}
                      onChange={(e) => patch({ remitterIe: e.target.value }, 'partes')}
                      placeholder="ISENTO se não contribuinte"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 border p-2 rounded bg-muted/20">
                  <div className="col-span-4 text-xs font-semibold text-muted-foreground uppercase">Endereço Remetente (Manual)</div>
                  <div className="col-span-2">
                    <Label className="text-xs">Logradouro</Label>
                    <Input className="h-8" value={active.remitterStreet} onChange={(e) => patch({ remitterStreet: e.target.value }, 'partes')} placeholder="Rua, Av, etc" />
                  </div>
                  <div>
                    <Label className="text-xs">Número</Label>
                    <Input className="h-8" value={active.remitterNumber} onChange={(e) => patch({ remitterNumber: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label className="text-xs">CEP</Label>
                    <Input className="h-8" value={active.remitterZip} onChange={(e) => patch({ remitterZip: e.target.value }, 'partes')} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Bairro</Label>
                    <Input className="h-8" value={active.remitterNeighborhood} onChange={(e) => patch({ remitterNeighborhood: e.target.value }, 'partes')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Destinatário</Label>
                    <Input value={active.recipientName} onChange={(e) => patch({ recipientName: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input value={active.recipientCnpj} onChange={(e) => patch({ recipientCnpj: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>IE destinatário</Label>
                    <Input
                      value={active.recipientIe}
                      onChange={(e) => patch({ recipientIe: e.target.value }, 'partes')}
                      placeholder="ISENTO se não contribuinte"
                    />
                  </div>
                  <div>
                    <Label>Município</Label>
                    <Input value={active.recipientCity} onChange={(e) => patch({ recipientCity: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input value={active.recipientState} onChange={(e) => patch({ recipientState: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>Logradouro (Manual)</Label>
                    <Input value={active.recipientStreet} onChange={(e) => patch({ recipientStreet: e.target.value }, 'partes')} placeholder="Rua, Av, etc" />
                  </div>
                  <div>
                    <Label>Número</Label>
                    <Input value={active.recipientNumber} onChange={(e) => patch({ recipientNumber: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>Bairro</Label>
                    <Input value={active.recipientNeighborhood} onChange={(e) => patch({ recipientNeighborhood: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>CEP</Label>
                    <Input value={active.recipientZip} onChange={(e) => patch({ recipientZip: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>Cód. Município (IBGE)</Label>
                    <Input value={active.recipientCityIbge} onChange={(e) => patch({ recipientCityIbge: e.target.value }, 'partes')} placeholder="Ex: 3143302" />
                  </div>
                </div>
                <div>
                  <Label>Consignatário (opcional)</Label>
                  <Select
                    value={active.consigneeClientId || 'none'}
                    onValueChange={(v) => {
                      if (v === 'none') return patch({ consigneeClientId: null, consigneeName: '', consigneeCnpj: '' }, 'partes');
                      const c: any = clients.find((x: any) => x.id === v);
                      patch({
                        consigneeClientId: v,
                        consigneeName: c?.company_name || '',
                        consigneeCnpj: c?.cnpj || '',
                      }, 'partes');
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
                    <Input value={active.expedidorName} onChange={(e) => patch({ expedidorName: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>CNPJ expedidor</Label>
                    <Input value={active.expedidorCnpj} onChange={(e) => patch({ expedidorCnpj: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>Recebedor (opcional)</Label>
                    <Input value={active.recebedorName} onChange={(e) => patch({ recebedorName: e.target.value }, 'partes')} />
                  </div>
                  <div>
                    <Label>CNPJ recebedor</Label>
                    <Input value={active.recebedorCnpj} onChange={(e) => patch({ recebedorCnpj: e.target.value }, 'partes')} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div>
                    <Label>Seguradora</Label>
                    <Input value={active.insurerName} onChange={(e) => patch({ insurerName: e.target.value }, 'partes')} />
                    {insuranceErrors.name && (
                      <p className="text-[11px] text-destructive">{insuranceErrors.name}</p>
                    )}
                  </div>
                  <div>
                    <Label>CNPJ seguradora</Label>
                    <Input
                      value={formatCnpj(active.insurerCnpj)}
                      inputMode="numeric"
                      placeholder="00.000.000/0000-00"
                      onChange={(e) => patch({ insurerCnpj: onlyDigits(e.target.value).slice(0, 14) }, 'partes')}
                    />
                    {insuranceErrors.cnpj && (
                      <p className="text-[11px] text-destructive">{insuranceErrors.cnpj}</p>
                    )}
                  </div>
                  <div>
                    <Label>Apólice</Label>
                    <Input value={active.insurerPolicy} onChange={(e) => patch({ insurerPolicy: e.target.value }, 'partes')} />
                    {insuranceErrors.policy && (
                      <p className="text-[11px] text-destructive">{insuranceErrors.policy}</p>
                    )}
                  </div>
                  <div>
                    <Label>Nº averbação / CGC</Label>
                    <Input value={active.insurerEndorsement} onChange={(e) => patch({ insurerEndorsement: e.target.value }, 'partes')} />
                    {insuranceErrors.endorsement && (
                      <p className="text-[11px] text-destructive">{insuranceErrors.endorsement}</p>
                    )}
                  </div>
                  <div>
                    <Label>Valor segurado (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={active.insurerInsuredAmount || active.cargoValue || 0}
                      onChange={(e) => patch({ insurerInsuredAmount: Number(e.target.value) }, 'partes')}
                    />
                  </div>
                  <div>
                    <Label>Seguro cobrado (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={active.fcInsurance}
                      onChange={(e) => patch({ fcInsurance: Number(e.target.value) }, 'partes')}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saveInsuranceProfile.isPending || !active.insurerName}
                    onClick={async () => {
                      try {
                        const saved = await saveInsuranceProfile.mutateAsync({
                          name: active.insurerName,
                          cnpj: active.insurerCnpj,
                          policy: active.insurerPolicy,
                        });
                        setItems((arr) => applyInsuranceProfileToBatch(arr, saved, true).items);
                        toast.success('Seguradora salva como padrão', {
                          description: 'Aplicada a este lote e às próximas emissões.',
                        });
                      } catch (e: any) {
                        toast.error('Falha ao salvar seguradora', { description: e?.message });
                      }
                    }}
                  >
                    Salvar seguradora como padrão
                  </Button>
                  {hasInsuranceProfile(insuranceProfile) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setItems((arr) => applyInsuranceProfileToBatch(arr, insuranceProfile, true).items);
                        toast.success('Seguradora padrão aplicada ao lote');
                      }}
                    >
                      Usar padrão salvo
                    </Button>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    Seguradora, CNPJ e apólice ficam salvos para todos os CT-es. O CNPJ preenche também a averbação/CGC.
                  </span>
                </div>
                {Object.keys(insuranceErrors).length > 0 && (
                  <p className="text-[11px] text-amber-600">
                    O DACTE só imprime o bloco de seguro com seguradora, CNPJ, nº da apólice e nº da averbação válidos —
                    a emissão fica bloqueada até a correção.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="tomador" className="space-y-3 pt-3">
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Responsável pelo Pagamento</div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={bulkEditTomador}
                      onChange={(e) => setBulkEditTomador(e.target.checked)}
                      className="h-3 w-3"
                    />
                    <span className={bulkEditTomador ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      Replicar dados desta aba para o lote
                    </span>
                  </label>
                </div>
                <Label>Tomador do serviço</Label>
                <RadioGroup value={active.takerRole} onValueChange={(v: any) => patch({ takerRole: v }, 'tomador')}>
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
                      <Input value={active.takerName} onChange={(e) => patch({ takerName: e.target.value }, 'tomador')} />
                    </div>
                    <div>
                      <Label>CNPJ</Label>
                      <Input value={active.takerCnpj} onChange={(e) => patch({ takerCnpj: e.target.value }, 'tomador')} />
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transporte" className="space-y-3 pt-3">
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Documento & Motorista</div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={bulkEditTransporte}
                      onChange={(e) => setBulkEditTransporte(e.target.checked)}
                      className="h-3 w-3"
                    />
                    <span className={bulkEditTransporte ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      Replicar dados desta aba para o lote
                    </span>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Tipo CT-e</Label>
                    <Select value={active.documentType} onValueChange={(v: any) => patch({ documentType: v }, 'transporte')}>
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
                    <Input value={active.refNumber} onChange={(e) => patch({ refNumber: e.target.value }, 'transporte')} />
                  </div>
                  <div>
                    <Label>Nº Pedido Cliente</Label>
                    <Input value={active.clientOrderNumber} onChange={(e) => patch({ clientOrderNumber: e.target.value }, 'transporte')} />
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
                      if (v === 'none') return patch({ driverId: null, driverName: '', driverCpf: '' }, 'transporte');
                      const d = drivers.find((x) => x.id === v);
                      patch({ driverId: v, driverName: d?.name || '', driverCpf: d?.cpf || '' }, 'transporte');
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
                    <Input value={active.driverName} onChange={(e) => patch({ driverName: e.target.value }, 'transporte')} />
                  </div>
                  <div>
                    <Label>CPF</Label>
                    <Input value={active.driverCpf} onChange={(e) => patch({ driverCpf: e.target.value }, 'transporte')} />
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
                      if (v === 'none') return patch({ vehicleId: null, vehiclePlate: '' }, 'transporte');
                      const veh: any = vehicles.find((x: any) => x.id === v);
                      patch({ vehicleId: v, vehiclePlate: veh?.plate || '' }, 'transporte');
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
                    <Input value={active.vehiclePlate} onChange={(e) => patch({ vehiclePlate: e.target.value.toUpperCase() }, 'transporte')} />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input value={active.vehicleState} onChange={(e) => patch({ vehicleState: e.target.value.toUpperCase() }, 'transporte')} />
                  </div>
                  <div>
                    <Label>RENAVAM</Label>
                    <Input value={active.vehicleRenavam} onChange={(e) => patch({ vehicleRenavam: e.target.value }, 'transporte')} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label>Tipo veículo</Label>
                    <Input value={active.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value }, 'transporte')} placeholder="01" />
                  </div>
                  <div>
                    <Label>Carreta 1</Label>
                    <Input value={active.trailerPlate1} onChange={(e) => patch({ trailerPlate1: e.target.value.toUpperCase() }, 'transporte')} />
                  </div>
                  <div>
                    <Label>Carreta 2</Label>
                    <Input value={active.trailerPlate2} onChange={(e) => patch({ trailerPlate2: e.target.value.toUpperCase() }, 'transporte')} />
                  </div>
                  <div>
                    <Label>Carreta 3</Label>
                    <Input value={active.trailerPlate3} onChange={(e) => patch({ trailerPlate3: e.target.value.toUpperCase() }, 'transporte')} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="carga" className="space-y-3 pt-3">
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Mercadoria & Valores</div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={bulkEditCarga}
                      onChange={(e) => setBulkEditCarga(e.target.checked)}
                      className="h-3 w-3"
                    />
                    <span className={bulkEditCarga ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      Replicar dados desta aba para o lote
                    </span>
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label>Frete peso — frete base (R$)</Label>
                    <Input type="number" step="0.01" value={Number(active.freightValue ?? 0).toFixed(2)}
                      onChange={(e) => patch({ freightValue: Math.round(Number(e.target.value) * 100) / 100 }, 'carga')} />
                  </div>
                  <div>
                    <Label>Valor carga (R$)</Label>
                    <Input type="number" step="0.01" value={active.cargoValue}
                      onChange={(e) => patch({ cargoValue: Number(e.target.value) }, 'carga')} />
                  </div>
                  <div>
                    <Label>Peso (kg)</Label>
                    <Input type="number" step="0.001" value={active.weightKg}
                      onChange={(e) => patch({ weightKg: Number(e.target.value) }, 'carga')} />
                  </div>
                  <div>
                    <Label>Pallets</Label>
                    <Input type="number" value={active.palletCount}
                      onChange={(e) => patch({ palletCount: Number(e.target.value) }, 'carga')} />
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <Label className="text-xs font-semibold">Mercadoria</Label>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <Label className="text-xs">Conteúdo</Label>
                      <Input value={active.cargoContent} onChange={(e) => patch({ cargoContent: e.target.value }, 'carga')} />
                    </div>
                    <div>
                      <Label className="text-xs">Espécie</Label>
                      <Input value={active.cargoSpecies} onChange={(e) => patch({ cargoSpecies: e.target.value }, 'carga')} />
                    </div>
                    <div>
                      <Label className="text-xs">Produto predominante</Label>
                      <Input value={active.cargoPredominant} onChange={(e) => patch({ cargoPredominant: e.target.value }, 'carga')} />
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
                          onChange={(e) => patch({ [k]: Number(e.target.value) } as any, 'carga')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                {(() => {
                  const acc =
                    (active.fcDeliveryFee || 0) + (active.fcOthers || 0) + (active.fcInsurance || 0) +
                    (active.fcDispatch || 0) + (active.fcGris || 0) + (active.fcToll || 0) +
                    (active.fcTracking || 0) + (active.fcLoading || 0) + (active.fcHelper || 0);
                  const fretePeso =
                    active.fcFreightWeight > 0
                      ? active.fcFreightWeight
                      : active.freightValue || 0;
                  const icmsSoma = active.icmsEmbutido === true;
                  const freteReceber =
                    fretePeso + acc + (icmsSoma ? active.icmsValor || 0 : 0);
                  const money = (n: number) =>
                    `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                  return (
                    <div className="pt-2 border-t">
                      <Label className="text-xs font-semibold">
                        Componentes do valor da prestação (impresso no DACTE)
                      </Label>
                      <div className="mt-1 rounded-md border divide-y text-sm">
                        <div className="flex justify-between px-3 py-1.5 font-semibold bg-muted/40">
                          <span>FRETE PESO</span>
                          <span>{money(fretePeso)}</span>
                        </div>
                        {active.fcInsurance > 0 && (
                          <div className="flex justify-between px-3 py-1.5">
                            <span>SEGURO</span>
                            <span>{money(active.fcInsurance)}</span>
                          </div>
                        )}
                        <div className="flex justify-between px-3 py-1.5 font-semibold bg-muted/40">
                          <span>
                            ICMS{' '}
                            <span className="font-normal text-[11px] text-muted-foreground">
                              {icmsSoma ? '(embutido — soma)' : '(por fora — destaque, não soma)'}
                            </span>
                          </span>
                          <span>{money(active.icmsValor)}</span>
                        </div>
                        <div className="flex justify-between px-3 py-1.5 font-semibold border-t-2">
                          <span>FRETE A RECEBER</span>
                          <span>{money(freteReceber)}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        FRETE PESO é o frete cru (base do cálculo). Com ICMS embutido, FRETE A
                        RECEBER = FRETE PESO + acessórios + ICMS. Sem embutido, o ICMS sai em
                        destaque no CT-e mas não é somado ao valor a receber.
                      </p>
                    </div>
                  );
                })()}
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
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Tributação & CFOP</div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                    <input
                      type="checkbox"
                      checked={bulkEditFiscal}
                      onChange={(e) => setBulkEditFiscal(e.target.checked)}
                      className="h-3 w-3"
                    />
                    <span className={bulkEditFiscal ? 'font-medium text-primary' : 'text-muted-foreground'}>
                      Replicar dados desta aba para o lote
                    </span>
                  </label>
                </div>
                <div>
                  <Label>Natureza da operação</Label>
                  <Input value={active.nature} onChange={(e) => patch({ nature: e.target.value }, 'fiscal')} />
                </div>
                <div>
                  <Label>CFOP</Label>
                  <Input value={active.cfop} onChange={(e) => patch({ cfop: e.target.value }, 'fiscal')} placeholder="ex.: 5353, 6353" />
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
                          const regime = (emitterForActive as any)?.regime_tributario;
                          const isSimples = regime === 'simples' || regime === 'mei';
                          const originUf = (emitterForActive as any)?.endereco?.uf || null;
                          const aliq = (isento || isSimples) ? 0 : suggestIcmsAliquota(originUf, active.recipientState);
                          const patchData: any = {
                            icmsCst: cst,
                            icmsIsento: isento,
                            icmsAliquota: aliq,
                            _aliqManual: false, // Ao trocar o CST, resetamos a trava
                          };
                          
                          // Se não for bulk edit, calculamos base/valor apenas para o ativo aqui
                          // Se for bulk edit, o patch() cuidará de replicar e o useEffect cuidará da sugestão/recalculo
                          if (bulkEditFiscal) {
                            // Se for bulk edit, aplicamos a todos os itens do lote que não tenham trava manual
                            setItems((prev) =>
                              prev.map((it) => {
                                if (it._aliqManual) return it;
                                const itemR = recalcIcms(it.freightValue || 0, aliq, it.icmsEmbutido, isento);
                                return {
                                  ...it,
                                  icmsCst: cst,
                                  icmsIsento: isento,
                                  icmsAliquota: aliq,
                                  icmsBase: itemR.base,
                                  icmsValor: itemR.valor,
                                };
                              }),
                            );
                          } else {
                            const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, isento);
                            patchData.icmsBase = r.base;
                            patchData.icmsValor = r.valor;
                          }
                          
                           patch(patchData, 'fiscal');
                        }}
                      >
                        <option value="00">00 — Tributação normal</option>
                        <option value="20">20 — Redução de base</option>
                        <option value="40">40 — Isenta</option>
                        <option value="41">41 — Não tributada</option>
                        <option value="51">51 — Diferimento</option>
                        <option value="60">60 — ICMS cobrado por ST</option>
                        <option value="90">90 — Outros / Simples Nacional</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={active.icmsEmbutido}
                        onChange={(e) => {
                          const regime = (emitterForActive as any)?.regime_tributario;
                          const isSimples = regime === 'simples' || regime === 'mei';
                          const embutido = e.target.checked;
                          const aliq = isSimples ? 0 : active.icmsAliquota;
                          const r = recalcIcms(active.freightValue || 0, aliq, embutido, active.icmsIsento || isSimples);
                          patch({ icmsEmbutido: embutido, icmsBase: r.base, icmsValor: r.valor, icmsAliquota: aliq }, 'fiscal');
                        }}
                      />
                      Embutido
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={active.icmsIsento}
                        onChange={(e) => {
                          const regime = (emitterForActive as any)?.regime_tributario;
                          const isSimples = regime === 'simples' || regime === 'mei';
                          const isento = e.target.checked || isSimples;
                          const aliq = isento ? 0 : active.icmsAliquota;
                          const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, isento);
                          patch({ icmsIsento: isento, icmsBase: r.base, icmsValor: r.valor, icmsAliquota: aliq }, 'fiscal');
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
                          const regime = (emitterForActive as any)?.regime_tributario;
                          const isSimples = regime === 'simples' || regime === 'mei';
                          const aliq = isSimples ? 0 : Number(e.target.value);
                          const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, active.icmsIsento || isSimples);
                           patch({
                            icmsAliquota: aliq,
                            icmsBase: r.base,
                            icmsValor: r.valor,
                            _aliqManual: true, // Marca que foi alterado manualmente para parar a sugestão
                          } as any, 'fiscal');
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
                          }, 'fiscal');
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Valor</Label>
                      <Input type="number" step="0.01" value={active.icmsValor} onChange={(e) => patch({ icmsValor: Number(e.target.value) }, 'fiscal')} />
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
                        const patchData: any = {
                          icmsAliquota: aliq,
                          _aliqManual: false, // Resetamos a trava ao clicar em recalcular
                        };

                        if (bulkEditFiscal) {
                          setItems((prev) =>
                            prev.map((it) => {
                              const itemR = recalcIcms(it.freightValue || 0, aliq, it.icmsEmbutido, isento);
                              return {
                                ...it,
                                icmsAliquota: aliq,
                                icmsBase: itemR.base,
                                icmsValor: itemR.valor,
                                _aliqManual: false,
                              };
                            }),
                          );
                        } else {
                          const r = recalcIcms(active.freightValue || 0, aliq, active.icmsEmbutido, isento);
                          patchData.icmsBase = r.base;
                          patchData.icmsValor = r.valor;
                        }
                        
                        patch(patchData, 'fiscal');
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
                      <Input type="number" step="0.01" value={active.cbsIbsBase} onChange={(e) => patch({ cbsIbsBase: Number(e.target.value) }, 'fiscal')} />
                    </div>
                    <div>
                      <Label className="text-xs">CBS % (padrão 0,90)</Label>
                      <Input type="number" step="0.01" value={active.cbsAliquota} onChange={(e) => patch({ cbsAliquota: Number(e.target.value) }, 'fiscal')} />
                    </div>
                    <div>
                      <Label className="text-xs">IBS % (padrão 0,10)</Label>
                      <Input type="number" step="0.01" value={active.ibsAliquota} onChange={(e) => patch({ ibsAliquota: Number(e.target.value) }, 'fiscal')} />
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
                  <Textarea rows={4} value={active.observations} onChange={(e) => patch({ observations: e.target.value }, 'fiscal')} />
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
          <Button disabled={!allValid || transmitting} onClick={handleTransmitClick}>
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