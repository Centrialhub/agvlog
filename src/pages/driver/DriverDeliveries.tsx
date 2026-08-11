import { useState, useRef, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Package, CheckCircle, AlertTriangle, Truck, Camera, X, ImageIcon,
  ChevronRight, ChevronDown, Search, PenLine, FileSignature,
  Ban, AlertCircle, PackageX, MapPinned, UserX,
  Phone, MessageSquare, Send, Percent, FileText, RotateCcw, Clock, User as UserIcon, Loader2
} from 'lucide-react';

const IS_PROD = import.meta.env.PROD;
import { cn } from '@/lib/utils';
import SignaturePad from '@/components/driver/SignaturePad';
import DemoBanner from '@/components/driver/DemoBanner';
import { canUseDriverDemo } from '@/lib/driver/demoMode';
import { isStopTerminal } from '@/lib/status/stopStatus';


// ====== Dados de demonstração ======
const DEMO_TRIP = {
  id: 'demo-trip',
  loads: { load_number: '1042 (DEMO)' },
};
const DEMO_STOPS_INITIAL: any[] = [
  { id: 'demo-1', stop_order: 1, status: 'arrived',  destination: 'Av. Brasil, 1200 - Centro, Pirapora/MG', notes: 'Pedido 2100077', clients: { company_name: 'AMANDA D', phone: '(38) 99876-1122', whatsapp: '5538998761122', email: 'amanda@cliente.com' } },
  { id: 'demo-2', stop_order: 2, status: 'pending',  destination: 'Rua das Flores, 45 - Jaíba/MG',          notes: 'NF 2100098',     clients: { company_name: 'LINDSAY @', phone: '(38) 99811-2233', whatsapp: '5538998112233', email: 'lindsay@cliente.com' } },
  { id: 'demo-3', stop_order: 3, status: 'pending',  destination: 'BR-365 km 12 - Pai Pedro/MG',            notes: 'Pedido 2100090', clients: { company_name: 'IRMÃOS FERREIRA', phone: '(38) 99700-1010', whatsapp: '5538997001010', email: 'financeiro@irmaosferreira.com' } },
  { id: 'demo-4', stop_order: 4, status: 'pending',  destination: 'Rua A, 200 - Janaúba/MG',                notes: 'NF 2100083',     clients: { company_name: 'CG BEATRIZ', phone: '(38) 99655-7788' } },
  { id: 'demo-5', stop_order: 5, status: 'pending',  destination: 'Av. JK, 800 - Montes Claros/MG',         notes: 'Pedido 2100115', clients: { company_name: 'VICTORIA', phone: '(38) 99511-4040' } },
  { id: 'demo-6', stop_order: 6, status: 'completed',destination: 'Centro - Espinosa/MG',                   notes: 'NF 2100050',     clients: { company_name: 'MERCADO BOM PRECO' } },
];

// Produtos fictícios por parada (em produção, virá de load_items / order_items)
type DemoProduct = { id: string; sku: string; name: string; qty: number; unit: string; price: number };
const DEMO_PRODUCTS_BY_STOP: Record<string, DemoProduct[]> = {
  'demo-1': [
    { id: 'p1', sku: '7891234', name: 'Refrigerante Cola 2L',   qty: 24, unit: 'UN', price: 7.90 },
    { id: 'p2', sku: '7891235', name: 'Suco Laranja 1L',         qty: 12, unit: 'UN', price: 5.50 },
    { id: 'p3', sku: '7891236', name: 'Água Mineral 500ml fardo',qty:  6, unit: 'FD', price: 18.00 },
  ],
  'demo-2': [
    { id: 'p4', sku: '7892001', name: 'Arroz 5kg Tipo 1',        qty: 20, unit: 'PC', price: 28.90 },
    { id: 'p5', sku: '7892002', name: 'Feijão Carioca 1kg',      qty: 30, unit: 'PC', price: 8.40 },
    { id: 'p6', sku: '7892003', name: 'Óleo Soja 900ml',         qty: 24, unit: 'UN', price: 6.20 },
  ],
  'demo-3': [
    { id: 'p7', sku: '7893001', name: 'Cimento CP-II 50kg',      qty: 40, unit: 'SC', price: 38.00 },
    { id: 'p8', sku: '7893002', name: 'Argamassa AC-II 20kg',    qty: 25, unit: 'SC', price: 22.50 },
  ],
  'demo-4': [
    { id: 'p9', sku: '7894001', name: 'Detergente 500ml',        qty: 48, unit: 'UN', price: 2.10 },
    { id: 'p10',sku: '7894002', name: 'Sabão em pó 1kg',         qty: 18, unit: 'UN', price: 11.50 },
  ],
  'demo-5': [
    { id: 'p11',sku: '7895001', name: 'Café Torrado 500g',       qty: 30, unit: 'UN', price: 14.90 },
  ],
};

// ====== Catálogo de eventos (inspirado no app de referência) ======
type EventCategory = 'finalizador' | 'informativo';

type EventDef = {
  key: string;
  label: string;
  icon: React.ComponentType<any>;
  category: EventCategory;
  finalAction?: 'delivered' | 'partial' | 'refused';
  requiresReceiver?: boolean;
  requiresPhoto?: boolean;
  requiresSignature?: boolean;
  showsItems?: boolean;     // lista produtos para devolver
  showsDiscount?: boolean;  // pede desconto
  showsContact?: boolean;   // mostra contato do cliente
  needsOperatorReply?: boolean; // exige aprovação do operador
};

const EVENTS: EventDef[] = [
  { key: 'entregue',            label: 'ENTREGUE',            icon: CheckCircle, category: 'finalizador', finalAction: 'delivered', requiresReceiver: true, requiresPhoto: true, requiresSignature: true },
  { key: 'devolucao_parcial',   label: 'DEVOLUÇÃO PARCIAL',   icon: PackageX,    category: 'finalizador', finalAction: 'partial', requiresReceiver: true, showsItems: true, needsOperatorReply: true },
  { key: 'devolucao_total',     label: 'DEVOLUÇÃO TOTAL',     icon: Ban,         category: 'finalizador', finalAction: 'refused', showsItems: true, needsOperatorReply: true },
  { key: 'chegada_no_cliente',  label: 'CHEGADA NO CLIENTE',  icon: MapPinned,   category: 'informativo' },
  { key: 'solicitar_desconto',  label: 'SOLICITAR DESCONTO',  icon: Percent,     category: 'informativo', showsDiscount: true, showsContact: true, needsOperatorReply: true },
  { key: 'atualizar_boleto',    label: 'ATUALIZAR BOLETO',    icon: FileText,    category: 'informativo', showsContact: true, needsOperatorReply: true },
  { key: 'avaria',              label: 'AVARIA',              icon: AlertCircle, category: 'informativo', requiresPhoto: true, showsItems: true },
  { key: 'cliente_recusou',     label: 'CLIENTE RECUSOU',     icon: PackageX,    category: 'informativo', showsItems: true },
  { key: 'coleta_realizada',    label: 'COLETA REALIZADA',    icon: Package,     category: 'informativo', requiresPhoto: true },
  { key: 'cliente_estava_fora', label: 'CLIENTE ESTAVA FORA', icon: UserX,       category: 'informativo' },
  { key: 'outros',              label: 'OUTROS',              icon: AlertTriangle, category: 'informativo' },
];

function getEventDef(key: string) {
  return EVENTS.find(e => e.key === key);
}

// ====== Helpers ======
function getStopOrderNumber(stop: any): string | null {
  // Procura nº pedido/nota em vários campos prováveis
  const candidates = [stop?.order_number, stop?.invoice_number, stop?.reference, stop?.external_id];
  for (const c of candidates) if (c) return String(c);
  // fallback: extrai dígitos do notes
  if (stop?.notes) {
    const m = String(stop.notes).match(/\d{4,}/);
    if (m) return m[0];
  }
  return null;
}

export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);

  // Em produção, nunca usar dados demo: melhor mostrar lista vazia que poluir POD.
  const isDemo = canUseDriverDemo && !trip;
  const [demoStops, setDemoStops] = useState<any[]>(DEMO_STOPS_INITIAL);
  const effectiveTrip: any = trip || DEMO_TRIP;

  const [tab, setTab] = useState<'em_rota' | 'concluidas'>('em_rota');
  const [search, setSearch] = useState('');
  // Detalhe da entrega
  const [detailStop, setDetailStop] = useState<any | null>(null);

  // catálogo de eventos do stop selecionado
  const [eventCatalogStop, setEventCatalogStop] = useState<any | null>(null);
  // formulário "Dados do evento"
  const [eventForm, setEventForm] = useState<{ stop: any; eventKey: string } | null>(null);

  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Itens selecionados para devolução: { [productId]: qtyDevolvida }
  const [returnedItems, setReturnedItems] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');

  // Solicitação de desconto
  const [discountKind, setDiscountKind] = useState<'percent' | 'value'>('percent');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  // Boleto / contato
  const [boletoDueDate, setBoletoDueDate] = useState('');
  const [boletoNote, setBoletoNote] = useState('');

  // Thread de mensagens (demo) — chave: stopId|eventKey
  type ThreadMsg = {
    id: string;
    from: 'driver' | 'operator';
    author: string;
    text: string;
    at: string;
    status?: 'pending' | 'approved' | 'rejected' | 'info';
  };
  const [threads, setThreads] = useState<Record<string, ThreadMsg[]>>({});
  const [followUp, setFollowUp] = useState('');

  const threadKey = eventForm ? `${eventForm.stop.id}|${eventForm.eventKey}` : '';
  const currentThread = threadKey ? (threads[threadKey] || []) : [];

  // Itens reais da parada: fiscal_documents da carga (por client_id da parada) → load_items.
  const { data: realStopProducts = [] } = useQuery({
    queryKey: ['driver_stop_products', trip?.load_id, eventForm?.stop?.client_id],
    queryFn: async () => {
      if (!trip?.load_id || !eventForm?.stop?.client_id) return [] as DemoProduct[];
      const { data: docs, error: docsErr } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number')
        .eq('load_id', trip.load_id)
        .eq('client_id', eventForm.stop.client_id);
      if (docsErr) throw docsErr;
      const docIds = (docs || []).map((d: any) => d.id);
      if (docIds.length === 0) return [] as DemoProduct[];
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('id, item_description, quantity, weight_kg, volume_m3, fiscal_document_id')
        .in('fiscal_document_id', docIds);
      if (itemsErr) throw itemsErr;
      return (items || []).map((it: any) => ({
        id: it.id,
        sku: it.fiscal_document_id ? String(it.fiscal_document_id).slice(0, 8) : '',
        name: it.item_description || 'Item',
        qty: Number(it.quantity) || 0,
        unit: 'UN',
        price: 0,
      })) as DemoProduct[];
    },
    enabled: !!eventForm?.stop && !isDemo && !!trip?.load_id && !!eventForm?.stop?.client_id,
  });

  const stopProducts: DemoProduct[] = eventForm
    ? (isDemo ? (DEMO_PRODUCTS_BY_STOP[eventForm.stop.id] || []) : realStopProducts)
    : [];

  const totalReturnValue = stopProducts.reduce((sum, p) => {
    const q = returnedItems[p.id] || 0;
    return sum + q * p.price;
  }, 0);

  const { data: stops = [] } = useQuery({
    queryKey: ['driver_delivery_stops', trip?.id],
    queryFn: async () => {
      if (!trip) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name)')
        .eq('dispatch_trip_id', trip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id,
  });

  const effectiveStops: any[] = isDemo ? demoStops : (stops as any[]);

  const filteredStops = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = effectiveStops;
    if (tab === 'em_rota') {
      list = list.filter((s) => !isStopTerminal(s.status) && s.status !== 'completed');
    } else {
      list = list.filter((s) => isStopTerminal(s.status) || s.status === 'completed');
    }
    if (!q) return list;
    return list.filter((s) => {
      const name = (s.clients?.company_name || s.destination || '').toLowerCase();
      const order = (getStopOrderNumber(s) || '').toLowerCase();
      const notes = (s.notes || '').toLowerCase();
      return name.includes(q) || order.includes(q) || notes.includes(q);
    });
  }, [effectiveStops, search, tab]);

  // Considera todos os status terminais (delivered, refused, returned, partial_delivery, failed, etc.)
  const completedStops = effectiveStops.filter(
    (s) => isStopTerminal(s.status) || s.status === 'completed' || s.status === 'delivered',
  );

  const resetForm = () => {
    setEventForm(null);
    setReceiverName('');
    setReceiverDoc('');
    setNotes('');
    setPhotos([]);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews([]);
    setSignatureDataUrl(null);
    setReturnedItems({});
    setReturnReason('');
    setDiscountKind('percent');
    setDiscountAmount('');
    setDiscountReason('');
    setBoletoDueDate('');
    setBoletoNote('');
    setFollowUp('');
    // Evita crescimento indefinido de mensagens em memória entre entregas.
    setThreads({});
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const next = [...photos, ...files].slice(0, 5);
    setPhotos(next);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviews[idx]);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitEvent = useMutation({
    mutationFn: async () => {
      if (!eventForm) throw new Error('Sem evento');
      const def = getEventDef(eventForm.eventKey);
      if (!def) throw new Error('Evento inválido');

      // Constrói a mensagem-resumo do motorista (usada em demo e produção).
      const buildDriverSummary = (): ThreadMsg => {
        const parts: string[] = [];
        parts.push(`Evento: ${def.label}`);
        if (receiverName) parts.push(`Recebedor: ${receiverName}${receiverDoc ? ` (${receiverDoc})` : ''}`);
        const itemsList = stopProducts.filter(p => (returnedItems[p.id] || 0) > 0);
        if (def.showsItems && itemsList.length) {
          parts.push(
            'Itens devolvidos:\n' + itemsList.map(p => `• ${p.name} — ${returnedItems[p.id]}/${p.qty} ${p.unit}`).join('\n')
          );
          if (returnReason) parts.push(`Motivo: ${returnReason}`);
          if (totalReturnValue > 0) parts.push(`Valor estimado: R$ ${totalReturnValue.toFixed(2)}`);
        }
        if (def.showsDiscount && discountAmount) {
          parts.push(`Desconto solicitado: ${discountAmount}${discountKind === 'percent' ? '%' : ' R$'}`);
          if (discountReason) parts.push(`Justificativa: ${discountReason}`);
        }
        if (def.key === 'atualizar_boleto') {
          if (boletoDueDate) parts.push(`Novo vencimento sugerido: ${boletoDueDate}`);
          if (boletoNote) parts.push(`Detalhe: ${boletoNote}`);
        }
        if (notes) parts.push(`Obs.: ${notes}`);
        return {
          id: `m-${Date.now()}`,
          from: 'driver',
          author: driver?.name || 'Motorista',
          text: parts.join('\n'),
          at: new Date().toISOString(),
          status: def.needsOperatorReply ? 'pending' : 'info',
        };
      };

      // Demo: muta apenas em memória, sem chamar Supabase
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 400));
        const initialMsg = buildDriverSummary();
        setThreads((prev) => ({ ...prev, [threadKey]: [...(prev[threadKey] || []), initialMsg] }));

        // Atualiza stop conforme finalAction (mesmo se aguardando operador, para refletir UI)
        setDemoStops((prev) =>
          prev.map((s) => {
            if (s.id !== eventForm.stop.id) return s;
            if (def.finalAction && !def.needsOperatorReply) return { ...s, status: def.finalAction === 'delivered' ? 'completed' : def.finalAction };
            if (def.key === 'chegada_no_cliente' && s.status === 'pending') return { ...s, status: 'arrived' };
            return s;
          })
        );

        // Simula resposta do operador (apenas demo)
        if (def.needsOperatorReply) {
          const replies: Record<string, { text: string; status: 'approved' | 'rejected' }> = {
            devolucao_parcial: { text: 'Devolução autorizada. Pode trazer os volumes marcados de volta ao CD.', status: 'approved' },
            devolucao_total: { text: 'Devolução total confirmada. Retorne com a carga e abriremos a NF de devolução.', status: 'approved' },
            solicitar_desconto: { text: 'Desconto aprovado conforme solicitado. Pode finalizar a entrega normalmente.', status: 'approved' },
            atualizar_boleto:   { text: 'Boleto atualizado e enviado por e-mail/WhatsApp ao cliente. Aguarde 2 min.', status: 'approved' },
          };
          const r = replies[def.key];
          if (r) {
            setTimeout(() => {
              setThreads((prev) => {
                const list = prev[threadKey] || [];
                const reply: ThreadMsg = {
                  id: `m-${Date.now()}-op`,
                  from: 'operator',
                  author: 'Operação CD',
                  text: r.text,
                  at: new Date().toISOString(),
                  status: r.status,
                };
                // marca a primeira pendente como respondida
                const updated = list.map((m, idx) =>
                  idx === 0 && m.status === 'pending' ? { ...m, status: r.status } : m
                );
                return { ...prev, [threadKey]: [...updated, reply] };
              });
              if (def.finalAction === 'partial' || def.finalAction === 'refused') {
                setDemoStops((prev) => prev.map((s) => s.id === eventForm.stop.id ? { ...s, status: 'completed' } : s));
              }
              toast({ title: 'Operação respondeu', description: r.text });
            }, 2200);
          }
        }
        return;
      }

      // Upload de fotos resiliente: se qualquer uma falhar, remove as já enviadas para
      // evitar arquivos órfãos sem link com o evento.
      const photoPaths: string[] = [];
      if (photos.length > 0) {
        const results = await Promise.allSettled(
          photos.map(async (photo) => {
            const ext = (photo.name.split('.').pop() || 'jpg').toLowerCase();
            const path = `${currentTenant!.id}/deliveries/${trip!.id}/${eventForm.stop.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
            const { error } = await supabase.storage.from('receipts').upload(path, photo, { contentType: photo.type });
            if (error) throw error;
            return path;
          }),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') photoPaths.push(r.value);
        }
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          if (photoPaths.length > 0) {
            await supabase.storage.from('receipts').remove(photoPaths).catch(() => {});
          }
          const firstErr = (failed[0] as PromiseRejectedResult).reason;
          throw new Error(`Falha ao enviar ${failed.length} foto(s): ${firstErr?.message || firstErr}`);
        }
      }

      let signaturePath: string | null = null;
      if (signatureDataUrl) {
        const blob = await (await fetch(signatureDataUrl)).blob();
        const path = `${currentTenant!.id}/deliveries/${trip!.id}/${eventForm.stop.id}/signature_${Date.now()}.png`;
        const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/png' });
        if (error) {
          if (photoPaths.length > 0) {
            await supabase.storage.from('receipts').remove(photoPaths).catch(() => {});
          }
          throw error;
        }
        signaturePath = path;
      }

      // Caminho seguro: finalizador "ENTREGUE" passa por RPC transacional.
      if (def.finalAction === 'delivered') {
        const { error: rpcErr } = await supabase.rpc('driver_finalize_delivery', {
          _stop_id: eventForm.stop.id,
          _receiver_name: receiverName.trim(),
          _signature_path: signaturePath,
          _photo_paths: photoPaths,
          _receiver_document: receiverDoc.trim() || null,
          _receiver_role: null,
          _notes: notes || null,
        } as any);
        if (rpcErr) throw rpcErr;
        return;
      }

      // Mapa de eventos → RPCs seguras. Nenhum write direto em tabela operacional.
      const reason = notes?.trim() || null;

      if (def.key === 'chegada_no_cliente') {
        const { error } = await supabase.rpc('driver_mark_arrival', { _stop_id: eventForm.stop.id } as any);
        if (error) throw error;
        return;
      }

      // Status finalizadores via driver_update_stop_status
      const STATUS_MAP: Record<string, string | undefined> = {
        devolucao_parcial: 'partial_delivery',
        devolucao_total: 'returned',
        cliente_recusou: 'refused',
        cliente_estava_fora: 'failed',
      };
      const mappedStatus = STATUS_MAP[def.key];
      if (mappedStatus) {
        const { error } = await supabase.rpc('driver_update_stop_status', {
          _stop_id: eventForm.stop.id,
          _new_status: mappedStatus,
          _reason: reason,
        } as any);
        if (error) throw error;
        // anexa evento contextual (fotos, recebedor, itens) sem alterar status
        await supabase.rpc('driver_create_event', {
          _trip_id: trip!.id,
          _event_type: `info_${def.key}`,
          _payload: {
            event_subtype: def.key,
            event_label: def.label,
            receiver_name: receiverName.trim() || null,
            receiver_document: receiverDoc.trim() || null,
            photo_paths: photoPaths,
            photo_count: photoPaths.length,
            signature_path: signaturePath,
            returned_items: returnedItems,
          },
          _stop_id: eventForm.stop.id,
          _notes: reason,
        } as any);
        // Popula thread local com o resumo do motorista para dar feedback visual imediato.
        setThreads((prev) => ({ ...prev, [threadKey]: [...(prev[threadKey] || []), buildDriverSummary()] }));
        return;
      }

      // Eventos informativos (avaria, solicitar_desconto, atualizar_boleto, coleta_realizada, etc.)
      const { error: evtErr } = await supabase.rpc('driver_create_event', {
        _trip_id: trip!.id,
        _event_type: `info_${def.key}`,
        _payload: {
          event_subtype: def.key,
          event_label: def.label,
          receiver_name: receiverName.trim() || null,
          receiver_document: receiverDoc.trim() || null,
          photo_paths: photoPaths,
          photo_count: photoPaths.length,
          signature_path: signaturePath,
          discount_amount: discountAmount || null,
          discount_kind: discountKind,
          discount_reason: discountReason || null,
          boleto_due_date: boletoDueDate || null,
          boleto_note: boletoNote || null,
        },
        _stop_id: eventForm.stop.id,
        _notes: reason,
      } as any);
      if (evtErr) throw evtErr;
      // Popula thread local com o resumo do motorista para dar feedback visual imediato.
      setThreads((prev) => ({ ...prev, [threadKey]: [...(prev[threadKey] || []), buildDriverSummary()] }));
    },
    onSuccess: () => {
      toast({ title: 'Evento lançado com sucesso' });
      resetForm();
      setEventCatalogStop(null);
      qc.invalidateQueries({ queryKey: ['driver_delivery_stops'] });
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const def = eventForm ? getEventDef(eventForm.eventKey) : null;
  const totalReturnedQty = Object.values(returnedItems).reduce((a, b) => a + (b || 0), 0);
  const canSubmit =
    !!def &&
    (!def.requiresReceiver || receiverName.trim().length >= 2) &&
    (!def.requiresPhoto || photos.length >= 1) &&
    (!def.requiresSignature || !!signatureDataUrl) &&
    (!def.showsItems || !def.finalAction || def.key === 'avaria' || def.key === 'cliente_recusou' || totalReturnedQty > 0) &&
    (!def.showsDiscount || (parseFloat(discountAmount) > 0 && discountReason.trim().length >= 3));

  const sendFollowUp = () => {
    if (!followUp.trim() || !threadKey) return;
    const msg: ThreadMsg = {
      id: `m-${Date.now()}-fu`,
      from: 'driver',
      author: driver?.name || 'Motorista',
      text: followUp.trim(),
      at: new Date().toISOString(),
      status: 'info',
    };
    setThreads((prev) => ({ ...prev, [threadKey]: [...(prev[threadKey] || []), msg] }));
    setFollowUp('');
    // resposta simulada do operador
    setTimeout(() => {
      setThreads((prev) => {
        const list = prev[threadKey] || [];
        const reply: ThreadMsg = {
          id: `m-${Date.now()}-opfu`,
          from: 'operator',
          author: 'Operação CD',
          text: 'Recebido, motorista. Vou verificar e te respondo em instantes.',
          at: new Date().toISOString(),
          status: 'info',
        };
        return { ...prev, [threadKey]: [...list, reply] };
      });
    }, 1500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Entregas e Coletas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {effectiveTrip.loads?.load_number || '—'} · {completedStops.length}/{effectiveStops.length} concluídas
        </p>
      </div>

      {isDemo && (
        <DemoBanner
          message="Sem viagem ativa — paradas e eventos são fictícios."
          onReset={() => setDemoStops(DEMO_STOPS_INITIAL)}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente ou nº da nota"
          className="pl-9 h-10 text-sm"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-2 w-full h-10">
          <TabsTrigger value="em_rota" className="text-xs">Em Rota ({filteredStops.length})</TabsTrigger>
          <TabsTrigger value="concluidas" className="text-xs">Concluídas ({completedStops.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3 space-y-2">
          {filteredStops.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? 'Nenhum resultado para a busca.' : 'Nenhuma parada nesta aba.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredStops.map((stop: any, idx: number) => {
              const orderNum = getStopOrderNumber(stop);
              const isArrived = stop.status === 'arrived';
              return (
                <Card key={stop.id} className={cn(isArrived && 'border-primary')}>
                  <button
                    type="button"
                    onClick={() => setDetailStop(stop)}
                    className="w-full text-left"
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md shrink-0 text-xs font-bold',
                        isArrived ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                      )}>
                        <span className="relative">
                          <Package className="h-4 w-4" />
                          <span className="absolute -top-2 -right-3 text-[9px] bg-warning text-warning-foreground rounded-full h-3.5 w-3.5 flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {stop.clients?.company_name || stop.destination || `Parada ${idx + 1}`}
                        </p>
                        {orderNum && (
                          <p className="text-[11px] text-muted-foreground">
                            Pedido: {orderNum}
                          </p>
                        )}
                      </div>
                      {isArrived && (
                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] mr-1">No local</Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </button>
                </Card>
              );
            })
          )}

          {tab === 'em_rota' && completedStops.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Concluídas</p>
              {completedStops.map((stop: any) => (
                <Card key={stop.id} className="opacity-70">
                  <CardContent className="p-3 flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">OK</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sheet: Catálogo de eventos */}
      <Sheet open={!!eventCatalogStop} onOpenChange={(o) => !o && setEventCatalogStop(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Listagem de eventos</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Finalizador</p>
              {EVENTS.filter((e) => e.category === 'finalizador').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Informativo</p>
              {EVENTS.filter((e) => e.category === 'informativo').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet: Dados do evento */}
      <Sheet open={!!eventForm} onOpenChange={(o) => !o && resetForm()}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Dados do evento</SheetTitle>
          </SheetHeader>
          {def && (
            <div className="space-y-4 mt-2">
              <div className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm font-medium flex items-center gap-2">
                <def.icon className="h-4 w-4" />
                Evento: <span className="font-bold">{def.label}</span>
              </div>

              {/* Cliente / parada resumo */}
              {eventForm?.stop && (
                <div className="rounded-md border border-border p-3 space-y-1 bg-muted/30">
                  <p className="text-sm font-semibold">{eventForm.stop.clients?.company_name || 'Cliente'}</p>
                  <p className="text-[11px] text-muted-foreground">{eventForm.stop.destination}</p>
                  {getStopOrderNumber(eventForm.stop) && (
                    <Badge variant="outline" className="text-[10px]">Pedido {getStopOrderNumber(eventForm.stop)}</Badge>
                  )}
                </div>
              )}

              {/* Contato do cliente (boleto / desconto) */}
              {def.showsContact && eventForm?.stop?.clients && (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contato do cliente</p>
                  {eventForm.stop.clients.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <a href={`tel:${eventForm.stop.clients.phone}`} className="text-primary">{eventForm.stop.clients.phone}</a>
                    </div>
                  )}
                  {eventForm.stop.clients.whatsapp && (
                    <div className="flex items-center gap-2 text-sm">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <a target="_blank" rel="noreferrer" href={`https://wa.me/${eventForm.stop.clients.whatsapp}`} className="text-primary">
                        WhatsApp
                      </a>
                    </div>
                  )}
                  {eventForm.stop.clients.email && (
                    <div className="text-[11px] text-muted-foreground">{eventForm.stop.clients.email}</div>
                  )}
                </div>
              )}

              {/* Bloco BOLETO */}
              {def.key === 'atualizar_boleto' && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Atualização de boleto</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Novo vencimento sugerido</Label>
                    <Input type="date" value={boletoDueDate} onChange={(e) => setBoletoDueDate(e.target.value)} className="h-10 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Detalhe / motivo</Label>
                    <Textarea rows={2} value={boletoNote} onChange={(e) => setBoletoNote(e.target.value)} placeholder="Ex.: cliente pediu prorrogar 3 dias úteis" className="text-sm" />
                  </div>
                </div>
              )}

              {/* Bloco DESCONTO */}
              {def.showsDiscount && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Solicitar desconto</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setDiscountKind('percent')} className={cn('text-xs h-9 rounded-md border', discountKind === 'percent' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>%</button>
                    <button type="button" onClick={() => setDiscountKind('value')} className={cn('text-xs h-9 rounded-md border', discountKind === 'value' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>R$</button>
                    <Input
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value.replace(',', '.'))}
                      inputMode="decimal"
                      placeholder={discountKind === 'percent' ? '5' : '50,00'}
                      className="h-9 text-sm"
                    />
                  </div>
                  <Textarea
                    rows={2}
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="Justificativa (obrigatório)"
                    className="text-sm"
                  />
                </div>
              )}

              {/* Bloco PRODUTOS para devolução */}
              {def.showsItems && stopProducts.length > 0 && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Produtos do cliente ({stopProducts.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const all: Record<string, number> = {};
                        stopProducts.forEach((p) => { all[p.id] = p.qty; });
                        setReturnedItems(all);
                      }}
                      className="text-[10px] text-primary"
                    >
                      Marcar tudo
                    </button>
                  </div>
                  <div className="space-y-2">
                    {stopProducts.map((p) => {
                      const q = returnedItems[p.id] || 0;
                      const checked = q > 0;
                      return (
                        <div key={p.id} className={cn('rounded-md border p-2 space-y-1.5', checked ? 'border-primary bg-primary/5' : 'border-border')}>
                          <button
                            type="button"
                            onClick={() => setReturnedItems((prev) => {
                              const next = { ...prev };
                              if (next[p.id]) delete next[p.id];
                              else next[p.id] = p.qty;
                              return next;
                            })}
                            className="w-full flex items-start gap-2 text-left"
                          >
                            <div className={cn('mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>
                              {checked && <CheckCircle className="h-3 w-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground">SKU {p.sku} · {p.qty} {p.unit} · R$ {p.price.toFixed(2)}</p>
                            </div>
                          </button>
                          {checked && (
                            <div className="flex items-center gap-2 pl-6">
                              <Label className="text-[10px] text-muted-foreground">Devolver:</Label>
                              <Input
                                type="number"
                                min={1}
                                max={p.qty}
                                value={q}
                                onChange={(e) => {
                                  const v = Math.min(p.qty, Math.max(0, parseInt(e.target.value || '0', 10)));
                                  setReturnedItems((prev) => ({ ...prev, [p.id]: v }));
                                }}
                                className="h-7 text-xs w-20"
                              />
                              <span className="text-[10px] text-muted-foreground">/ {p.qty} {p.unit}</span>
                              <span className="ml-auto text-[10px] font-semibold">R$ {(q * p.price).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {totalReturnedQty > 0 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border text-xs">
                      <span className="text-muted-foreground">Total devolução</span>
                      <span className="font-semibold">R$ {totalReturnValue.toFixed(2)}</span>
                    </div>
                  )}
                  <Textarea
                    rows={2}
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="Motivo da devolução (avaria, validade, divergência...)"
                    className="text-sm"
                  />
                </div>
              )}

              {/* Recebedor */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Recebedor {def.requiresReceiver && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  placeholder="Digite o nome aqui"
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  className="text-sm h-10"
                  maxLength={120}
                />
              </div>

              {/* Documento */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Número do documento</Label>
                <Input
                  placeholder="RG/CPF"
                  value={receiverDoc}
                  onChange={(e) => setReceiverDoc(e.target.value)}
                  className="text-sm h-10"
                  inputMode="numeric"
                  maxLength={20}
                />
              </div>

              {/* Observações */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Observações</Label>
                <Textarea
                  placeholder="Observações"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm"
                  maxLength={500}
                />
              </div>

              {/* Fotos preview */}
              {photoPreviews.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Fotos <span className="text-muted-foreground font-normal">({photos.length}/5)</span>
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {photoPreviews.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-md overflow-hidden border border-border">
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assinatura inline */}
              {def.requiresSignature && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Assinatura <span className="text-destructive">*</span>
                  </Label>
                  <SignaturePad onChange={setSignatureDataUrl} />
                </div>
              )}

              {/* Action grid: Assinatura | Câmera | Galeria */}
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  icon={FileSignature}
                  label="Assinatura"
                  active={!!signatureDataUrl}
                  onClick={() => {
                    // se não estiver visível ainda, força requisitos
                    if (!def.requiresSignature) {
                      toast({ title: 'Assinatura opcional', description: 'Use o quadro abaixo para assinar.' });
                    }
                    document.getElementById('sig-anchor')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
                <ActionButton
                  icon={Camera}
                  label="Câmera"
                  active={photos.length > 0}
                  onClick={() => cameraInputRef.current?.click()}
                />
                <ActionButton
                  icon={ImageIcon}
                  label="Galeria"
                  active={photos.length > 0}
                  onClick={() => galleryInputRef.current?.click()}
                />
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />

              <div id="sig-anchor" />

              {/* Fallback signature pad para finalizador requerido — já renderizado acima quando required */}

              {/* Validação */}
              {!canSubmit && (
                <div className="bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
                  {def.requiresReceiver && receiverName.trim().length < 2 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Informe o nome do recebedor
                    </p>
                  )}
                  {def.requiresPhoto && photos.length === 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Adicione pelo menos 1 foto
                    </p>
                  )}
                  {def.requiresSignature && !signatureDataUrl && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Capture a assinatura
                    </p>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={() => submitEvent.mutate()}
                disabled={!canSubmit || submitEvent.isPending}
              >
                {submitEvent.isPending ? 'Enviando...' : 'Lançar evento'}
              </Button>

              {/* Thread de mensagens com a operação */}
              {currentThread.length > 0 && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Conversa com a operação
                    </p>
                    {currentThread[0]?.status === 'pending' && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Clock className="h-3 w-3" /> Aguardando
                      </Badge>
                    )}
                    {currentThread.some(m => m.status === 'approved') && (
                      <Badge className="text-[10px] bg-success text-success-foreground">Aprovado</Badge>
                    )}
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {currentThread.map((m) => (
                      <div key={m.id} className={cn('flex flex-col', m.from === 'driver' ? 'items-end' : 'items-start')}>
                        <div className={cn(
                          'max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap',
                          m.from === 'driver' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                        )}>
                          {m.text}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                          <UserIcon className="h-2.5 w-2.5" />
                          <span>{m.author}</span>
                          <span>·</span>
                          <span>{new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-border">
                    <Input
                      value={followUp}
                      onChange={(e) => setFollowUp(e.target.value)}
                      placeholder="Enviar mensagem para a operação..."
                      className="h-9 text-xs"
                      onKeyDown={(e) => { if (e.key === 'Enter') sendFollowUp(); }}
                    />
                    <Button size="sm" onClick={sendFollowUp} disabled={!followUp.trim()}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet: Detalhe da entrega (espelho do app de referência) */}
      <Sheet open={!!detailStop} onOpenChange={(o) => !o && setDetailStop(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base text-center">Entrega</SheetTitle>
          </SheetHeader>
          {detailStop && (
            <div className="space-y-4 mt-2">
              {/* Badge nº pedido */}
              <div className="flex justify-center">
                <Badge variant="secondary" className="bg-primary/10 text-primary px-3 py-1 text-xs">
                  Outro: {getStopOrderNumber(detailStop) || '—'}
                </Badge>
              </div>

              {/* Card cliente */}
              <div className="rounded-lg border border-border overflow-hidden flex">
                <div className="w-1.5 bg-primary" />
                <div className="flex-1 p-3 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-bold truncate">
                      {detailStop.clients?.company_name || 'Cliente'}
                    </p>
                    {detailStop.destination && (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {detailStop.destination}
                      </p>
                    )}
                    {detailStop.notes && (
                      <p className="text-[11px] text-muted-foreground">
                        {detailStop.notes}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Saída / Previsão */}
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold">Saída</p>
                  <p className="text-xs text-muted-foreground">
                    {detailStop.actual_arrival_at
                      ? new Date(detailStop.actual_arrival_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : 'Dia ' + new Date().toLocaleDateString('pt-BR') + ' às 05:00'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold">Previsão</p>
                  <p className="text-xs text-muted-foreground">
                    Dia {new Date().toLocaleDateString('pt-BR')}, das 08:00 às 18:00
                  </p>
                </div>
              </div>

              {/* Status atual */}
              <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Status</span>
                <Badge variant="secondary" className={cn(
                  'text-[10px]',
                  detailStop.status === 'arrived' && 'bg-primary/10 text-primary',
                  detailStop.status === 'completed' && 'bg-green-100 text-green-700',
                )}>
                  {detailStop.status === 'arrived' ? 'No local'
                    : detailStop.status === 'completed' ? 'Concluída'
                    : 'Pendente'}
                </Badge>
              </div>

              {/* Ações principais */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setEventCatalogStop(detailStop);
                    setDetailStop(null);
                  }}
                  disabled={detailStop.status === 'completed'}
                >
                  <PenLine className="h-4 w-4 mr-1.5" /> Lançar evento
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setEventForm({ stop: detailStop, eventKey: 'entregue' });
                    setDetailStop(null);
                  }}
                  disabled={detailStop.status === 'completed'}
                >
                  <CheckCircle className="h-4 w-4 mr-1.5" /> TudoEntregue
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActionButton({
  icon: Icon, label, active, onClick,
}: { icon: React.ComponentType<any>; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 py-3 rounded-md border transition-colors min-h-16',
        active
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border hover:bg-accent active:bg-accent/70 text-foreground'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}