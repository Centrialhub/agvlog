import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useDrivers } from '@/hooks/useDrivers';
import type { Json } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useCreatePickupOrder, type CreatePickupOrderInput, type PickupOrder } from '@/hooks/usePickupOrders';
import { maskCpfCnpj, maskCurrencyBRL } from '@/lib/inputMasks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (pickup: PickupOrder) => void;
}

const NONE = '__none__';

const empty = () => ({
  // Documento
  doc_numero: '', doc_serie: '', pre_fatura: '', sgl_emp: '', sgl_fil: '',
  nf_ref: '', nf_int: '0', situacao_doc: '00', situacao_label: 'Documento regular',
  nf_servico: '', data_emissao: new Date().toISOString().slice(0, 16),
  agente: '', tab_icms: '', local_emissao: '', prev_entrega: '',
  nat_prestacao: 'TRANSP. INTERMUNICIPAL (COM)', modal: 'Rodoviário',
  emitente: '', calculado_ate: 'DESTINO',
  carga_lotacao: true, impresso: false, cte: false, cortesia: false, rom_exp: false,
  importado_xml: false, nfs_x_ort: true, anulado_subst: false,
  doc_anu_subst: '', doc_cpl: '',
  // Remetente
  rem_nome: '', rem_endereco: '', rem_cnpj: '', rem_ie: '', rem_bairro: '', rem_municipio: '',
  // Destinatário
  dest_nome: '', dest_endereco: '', dest_cnpj: '', dest_ie: '', dest_bairro: '', dest_municipio: '',
  // Consignatário/Pagador
  cons_nome: '', cons_endereco: '', cons_cnpj: '', cons_ie: '', cons_bairro: '', cons_municipio: '',
  pagador_tipo: 'CIF', // CIF / FOB / Consignatario
  observacao: '', obs_manual: '',
  // Dados Gerais do Conhecimento
  origem_prest: '', destino_prest: '', etapa: '', nped_cliente: '',
  tipo_ctrc: '01', tipo_ctrc_label: 'NORMAL',
  classe_fat: 'G', classe_fat_label: 'GERAL', prioridade_frete: 'N',
  motorista: '', seguradora: '',
  placa: '', placa_carreta: '', placa_carreta_2: '', placa_carreta_3: '',
  data_averbacao: '', n_averbacao: '', tipo_veiculo: '', tip_dis: '02',
  // Mercadoria
  conteudo: 'CONFORME NF', peso: '0,000', volume_m3: '0', qtd_itens: '0', qtd_entrega: '',
  especie: 'CONFORME NF', valor_mercadoria: 'R$ 0,00', qtd: '0', peso_cubado: '0,00',
  prod_predominante: '', valor_container: '',
  // Composição do frete
  composicao_auto: true, composicao_rateio: false,
  frete_automatico: '', frete_peso: 'R$ 0,00', frete_peso_2: '0,000000',
  valor_entrega: 'R$ 0,00', outros: 'R$ 0,00',
  seguro: '0,00%', seguro_valor: 'R$ 0,00',
  despacho: 'R$ 0,00', vl_frete_parceiro: 'R$ 0,00',
  seguro_calc: 'R$ 0,00', valor_gr_gris: 'R$ 0,00', vl_frete_carreteiro: 'R$ 0,00',
  rastreamento: 'R$ 0,00', carga_descarga: 'R$ 0,00', agenciador: 'R$ 0,00',
  pedagio: 'R$ 0,00', tp_des_ped: '',
  // ICMS / Incidência
  embutido: false, gnre: false, icms_isento: false, subst_trib: false,
  ref_aliquota: '', st_perc: '0,00%',
  base_calculo: 'R$ 0,00', base_calculo_perc: '100,0000%', desc_st: 'R$ 0,00',
  valor_icms: 'R$ 0,00', tp_des_st: '',
  base_gnre: '0,00%', valor_guia_gnre: 'R$ 0,00',
  aliquota_gnre: '0,00%', valor_frete_gnre: 'R$ 0,00',
  aliquota_pis: '0,65%', valor_pis: 'R$ 0,00',
  // Plano de Pagamento (Financeiro)
  plano_pagto_codigo: '',
  plano_pagto_descricao: '',
  condicao_pagto: 'A_VISTA', // A_VISTA | A_PRAZO | FATURADO | BOLETO | PIX | DEPOSITO
  forma_pagto: 'BOLETO',
  prazo_dias: '0',
  qtd_parcelas: '1',
  primeiro_vencimento: '',
  valor_total_receber: 'R$ 0,00',
  centro_custo: '',
  conta_financeira: '',
  historico_financeiro: '',
  gera_titulo_financeiro: true,
});

type FormState = ReturnType<typeof empty>;
type TextFormKey = {
  [Key in keyof FormState]: FormState[Key] extends string ? Key : never;
}[keyof FormState];
type BooleanFormKey = {
  [Key in keyof FormState]: FormState[Key] extends boolean ? Key : never;
}[keyof FormState];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada ao salvar a ORT';
}

export default function NewManualOrtDialog({ open, onOpenChange, onCreated }: Props) {
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { toast } = useToast();
  const createMut = useCreatePickupOrder();

  const [form, setForm] = useState<FormState>(empty);
  const [remitterClientId, setRemitterClientId] = useState<string>(NONE);
  const [driverId, setDriverId] = useState<string>(NONE);
  const [vehicleId, setVehicleId] = useState<string>(NONE);

  const { data: drivers = [] } = useDrivers({ enabled: open });

  const setText = (k: TextFormKey, v: string) =>
    setForm(f => ({ ...f, [k]: v }));
  const setBoolean = (k: BooleanFormKey, v: boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleClientSelect = (id: string) => {
    setRemitterClientId(id);
    const c = clients.find((client) => client.id === id);
    if (c) {
      setForm(f => ({
        ...f,
        rem_nome: c.company_name || '',
        rem_cnpj: c.tax_id || '',
        rem_endereco: c.address_street || '',
        rem_municipio: c.address_city || '',
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dest_nome.trim()) {
      toast({ title: 'Destinatário obrigatório', variant: 'destructive' });
      return;
    }
    const driver = drivers.find((candidate) => candidate.id === driverId);
    const vehicle = vehicles.find(v => v.id === vehicleId);
    try {
      const payload: CreatePickupOrderInput = {
        remitter_client_id: remitterClientId !== NONE ? remitterClientId : null,
        remitter_name: form.rem_nome.trim() || null,
        remitter_cnpj: form.rem_cnpj.trim() || null,
        recipient_name: form.dest_nome.trim(),
        driver_id: driver?.id || null,
        driver_name_snapshot: driver?.name || form.motorista || null,
        vehicle_id: vehicle?.id || null,
        vehicle_plate_snapshot: vehicle?.plate || form.placa || null,
        pickup_at: new Date(form.data_emissao).toISOString(),
        status: 'pendente',
        notes: form.observacao.trim() || form.obs_manual.trim() || null,
        manual_meta: { ...form } satisfies Json,
      };
      const created = await createMut.mutateAsync(payload);
      toast({ title: `ORT manual nº ${created.pickup_number} criada` });
      onCreated?.(created);
      onOpenChange(false);
      setForm(empty());
      setRemitterClientId(NONE);
      setDriverId(NONE);
      setVehicleId(NONE);
    } catch (error: unknown) {
      toast({ title: 'Erro ao salvar ORT', description: errorMessage(error), variant: 'destructive' });
    }
  };

  const F = (label: string, k: TextFormKey, opts?: { type?: string; cls?: string; mask?: 'cpfcnpj' | 'currency' }) => (
    <div className={`space-y-1 ${opts?.cls || ''}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        type={opts?.type || 'text'}
        value={String(form[k] ?? '')}
        onChange={e => {
          let v = e.target.value;
          if (opts?.mask === 'cpfcnpj') v = maskCpfCnpj(v);
          if (opts?.mask === 'currency') v = maskCurrencyBRL(v);
          setText(k, v);
        }}
        className="h-8 text-sm"
      />
    </div>
  );

  const C = (label: string, k: BooleanFormKey) => (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox checked={form[k]} onCheckedChange={v => setBoolean(k, !!v)} /> {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova ORT Manual — Outras Receitas com Transportes</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs defaultValue="doc" className="space-y-3">
            <TabsList className="grid grid-cols-6 w-full">
              <TabsTrigger value="doc">Documento</TabsTrigger>
              <TabsTrigger value="partes">Partes</TabsTrigger>
              <TabsTrigger value="conhec">Conhecimento</TabsTrigger>
              <TabsTrigger value="merc">Mercadoria</TabsTrigger>
              <TabsTrigger value="frete">Frete / ICMS</TabsTrigger>
              <TabsTrigger value="pagto">Pagamento</TabsTrigger>
            </TabsList>

            {/* DOCUMENTO */}
            <TabsContent value="doc" className="space-y-3 border rounded-md p-3">
              <div className="flex flex-wrap gap-3">
                {C('Carga Lotação', 'carga_lotacao')}
                {C('Impresso', 'impresso')}
                {C('CT-e', 'cte')}
                {C('Cortesia', 'cortesia')}
                {C('Rom. Exp.', 'rom_exp')}
                {C('Importado XML', 'importado_xml')}
                {C('Nfs x ORT', 'nfs_x_ort')}
                {C('Anulado/Subst.', 'anulado_subst')}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {F('Nº Documento', 'doc_numero')}
                {F('Série', 'doc_serie')}
                {F('Pré-fatura', 'pre_fatura')}
                {F('Sgl EMP', 'sgl_emp')}
                {F('Sgl FIL', 'sgl_fil')}
                {F('Nº Ref.', 'nf_ref')}
                {F('Nº Int.', 'nf_int')}
                {F('Situação doc.', 'situacao_doc')}
                {F('Nº Nota Fiscal Serviço', 'nf_servico')}
                {F('Data Emissão', 'data_emissao', { type: 'datetime-local' })}
                {F('Agente', 'agente')}
                {F('Tab. ICMS', 'tab_icms')}
                {F('Local Emissão', 'local_emissao')}
                {F('Prev. entrega data/hora', 'prev_entrega', { type: 'datetime-local' })}
                <div className="space-y-1">
                  <Label className="text-xs">Nat. Prestação</Label>
                  <Input value={form.nat_prestacao} onChange={e => setText('nat_prestacao', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Modal</Label>
                  <Select value={form.modal} onValueChange={v => setText('modal', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Rodoviário">Rodoviário</SelectItem>
                      <SelectItem value="Aéreo">Aéreo</SelectItem>
                      <SelectItem value="Ferroviário">Ferroviário</SelectItem>
                      <SelectItem value="Aquaviário">Aquaviário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {F('Emitente', 'emitente')}
                {F('Calculado até', 'calculado_ate')}
                {F('Doc Anu./Subst.', 'doc_anu_subst')}
                {F('Doc Cpl.', 'doc_cpl')}
              </div>
            </TabsContent>

            {/* PARTES */}
            <TabsContent value="partes" className="space-y-4 border rounded-md p-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Remetente</div>
                  <div className="w-72">
                    <Select value={remitterClientId} onValueChange={handleClientSelect}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Buscar cliente cadastrado…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— manual —</SelectItem>
                        {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {F('Nome', 'rem_nome', { cls: 'md:col-span-2' })}
                  {F('Endereço', 'rem_endereco')}
                  {F('CNPJ/CPF', 'rem_cnpj', { mask: 'cpfcnpj' })}
                  {F('IE', 'rem_ie')}
                  {F('Bairro', 'rem_bairro')}
                  {F('Município', 'rem_municipio', { cls: 'md:col-span-2' })}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold mb-2">Destinatário *</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {F('Nome *', 'dest_nome', { cls: 'md:col-span-2' })}
                  {F('Endereço', 'dest_endereco')}
                  {F('CNPJ/CPF', 'dest_cnpj', { mask: 'cpfcnpj' })}
                  {F('IE', 'dest_ie')}
                  {F('Bairro', 'dest_bairro')}
                  {F('Município', 'dest_municipio', { cls: 'md:col-span-2' })}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Consignatário / Pagador</div>
                  <div className="flex gap-3">
                    {(['CIF', 'FOB', 'Consignatario'] as const).map(opt => (
                      <label key={opt} className="flex items-center gap-1 text-xs">
                        <input type="radio" checked={form.pagador_tipo === opt}
                          onChange={() => setText('pagador_tipo', opt)} /> {opt === 'CIF' ? 'Pago (CIF)' : opt === 'FOB' ? 'À pagar (FOB)' : 'Consignatário'}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {F('Nome', 'cons_nome', { cls: 'md:col-span-2' })}
                  {F('Endereço', 'cons_endereco')}
                  {F('CNPJ/CPF', 'cons_cnpj', { mask: 'cpfcnpj' })}
                  {F('IE', 'cons_ie')}
                  {F('Bairro', 'cons_bairro')}
                  {F('Município', 'cons_municipio', { cls: 'md:col-span-2' })}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Observação</Label>
                <Textarea value={form.observacao} onChange={e => setText('observacao', e.target.value)} rows={2} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Obs. Manual</Label>
                <Textarea value={form.obs_manual} onChange={e => setText('obs_manual', e.target.value)} rows={2} />
              </div>
            </TabsContent>

            {/* CONHECIMENTO */}
            <TabsContent value="conhec" className="space-y-3 border rounded-md p-3">
              <div className="text-sm font-semibold">Dados Gerais do Conhecimento</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {F('Origem Prest.', 'origem_prest', { cls: 'md:col-span-2' })}
                {F('Etapa', 'etapa')}
                {F('Nº Ped. Cliente', 'nped_cliente')}
                {F('Destino Prest.', 'destino_prest', { cls: 'md:col-span-2' })}
                {F('Tipo CTRC', 'tipo_ctrc')}
                {F('Descrição CTRC', 'tipo_ctrc_label')}
                {F('Classe (Fat)', 'classe_fat')}
                {F('Descrição Classe', 'classe_fat_label')}
                {F('Prioridade Frete', 'prioridade_frete')}
                <div className="space-y-1">
                  <Label className="text-xs">Motorista (cadastrado)</Label>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {drivers.map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {F('Motorista (texto livre)', 'motorista')}
                {F('Seguradora', 'seguradora')}
                <div className="space-y-1">
                  <Label className="text-xs">Placa (veículo cadastrado)</Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {F('Placa (texto)', 'placa')}
                {F('Placa Carreta', 'placa_carreta')}
                {F('Placa Carreta 2', 'placa_carreta_2')}
                {F('Placa Carreta 3', 'placa_carreta_3')}
                {F('Data Averbação', 'data_averbacao', { type: 'date' })}
                {F('Nº Averbação', 'n_averbacao')}
                {F('Tipo Veículo', 'tipo_veiculo')}
                {F('Tip Dis.', 'tip_dis')}
              </div>
            </TabsContent>

            {/* MERCADORIA */}
            <TabsContent value="merc" className="space-y-3 border rounded-md p-3">
              <div className="text-sm font-semibold">Mercadoria Transportada</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {F('Conteúdo', 'conteudo', { cls: 'md:col-span-2' })}
                {F('Peso (kg)', 'peso')}
                {F('Volume (M³)', 'volume_m3')}
                {F('Qtd itens', 'qtd_itens')}
                {F('Qtd Entrega', 'qtd_entrega')}
                {F('Espécie', 'especie')}
                {F('Valor', 'valor_mercadoria', { mask: 'currency' })}
                {F('Qtd', 'qtd')}
                {F('Peso cubado', 'peso_cubado')}
                {F('Prod. Predominante', 'prod_predominante', { cls: 'md:col-span-3' })}
                {F('Valor Container', 'valor_container', { mask: 'currency' })}
              </div>
            </TabsContent>

            {/* FRETE / ICMS */}
            <TabsContent value="frete" className="space-y-4 border rounded-md p-3">
              <div className="flex items-center gap-4">
                <div className="text-sm font-semibold">Composição do Frete</div>
                {C('Automático', 'composicao_auto')}
                {C('Rateio', 'composicao_rateio')}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {F('Frete Automático', 'frete_automatico', { mask: 'currency', cls: 'md:col-span-2' })}
                {F('Frete Peso', 'frete_peso', { mask: 'currency' })}
                {F('Frete Peso (qtd)', 'frete_peso_2')}
                {F('Valor Entrega', 'valor_entrega', { mask: 'currency' })}
                {F('Outros', 'outros', { mask: 'currency' })}
                {F('Seguro %', 'seguro')}
                {F('Seguro Valor', 'seguro_valor', { mask: 'currency' })}
                {F('Despacho/Paletização', 'despacho', { mask: 'currency' })}
                {F('Vl Frete Parceiro', 'vl_frete_parceiro', { mask: 'currency' })}
                {F('Seguro Calc.', 'seguro_calc', { mask: 'currency' })}
                {F('Valor GR (GRIS)', 'valor_gr_gris', { mask: 'currency' })}
                {F('Vl Frete Carreteiro', 'vl_frete_carreteiro', { mask: 'currency' })}
                {F('Rastreamento', 'rastreamento', { mask: 'currency' })}
                {F('Carga/Descarga', 'carga_descarga', { mask: 'currency' })}
                {F('Agenciador/Ajudante', 'agenciador', { mask: 'currency' })}
                {F('Pedágio', 'pedagio', { mask: 'currency' })}
                {F('Tp.Des.Ped', 'tp_des_ped')}
              </div>
              <div className="border-t pt-3">
                <div className="text-sm font-semibold mb-2">ICMS / Incidência</div>
                <div className="flex flex-wrap gap-3 mb-2">
                  {C('Embutido', 'embutido')}
                  {C('GNRE', 'gnre')}
                  {C('ICMS Isento', 'icms_isento')}
                  {C('Subst. Tributária', 'subst_trib')}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {F('Ref. Alíquota', 'ref_aliquota')}
                  {F('%ST', 'st_perc')}
                  {F('Base de Cálculo', 'base_calculo', { mask: 'currency' })}
                  {F('Base Cálc. %', 'base_calculo_perc')}
                  {F('Desc. ST', 'desc_st', { mask: 'currency' })}
                  {F('Valor ICMS', 'valor_icms', { mask: 'currency' })}
                  {F('Tp.Des.ST', 'tp_des_st')}
                  {F('Base GNRE %', 'base_gnre')}
                  {F('Valor Guia GNRE', 'valor_guia_gnre', { mask: 'currency' })}
                  {F('Alíquota GNRE', 'aliquota_gnre')}
                  {F('Valor Frete GNRE', 'valor_frete_gnre', { mask: 'currency' })}
                  {F('Alíquota PIS', 'aliquota_pis')}
                  {F('Valor PIS', 'valor_pis', { mask: 'currency' })}
                </div>
              </div>
            </TabsContent>

            {/* PLANO DE PAGAMENTO */}
            <TabsContent value="pagto" className="space-y-4 border rounded-md p-3">
              <div className="text-sm font-semibold">Plano de Pagamento — Financeiro</div>
              <div className="flex flex-wrap gap-3">
                {C('Gerar título no financeiro', 'gera_titulo_financeiro')}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {F('Cód. Plano Pagto', 'plano_pagto_codigo')}
                {F('Descrição Plano', 'plano_pagto_descricao', { cls: 'md:col-span-3' })}
                <div className="space-y-1">
                  <Label className="text-xs">Condição</Label>
                  <Select value={form.condicao_pagto} onValueChange={v => setText('condicao_pagto', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A_VISTA">À Vista</SelectItem>
                      <SelectItem value="A_PRAZO">A Prazo</SelectItem>
                      <SelectItem value="FATURADO">Faturado</SelectItem>
                      <SelectItem value="BOLETO">Boleto</SelectItem>
                      <SelectItem value="PIX">PIX</SelectItem>
                      <SelectItem value="DEPOSITO">Depósito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Forma Pagto</Label>
                  <Select value={form.forma_pagto} onValueChange={v => setText('forma_pagto', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOLETO">Boleto</SelectItem>
                      <SelectItem value="PIX">PIX</SelectItem>
                      <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
                      <SelectItem value="DEPOSITO">Depósito</SelectItem>
                      <SelectItem value="CARTAO">Cartão</SelectItem>
                      <SelectItem value="CHEQUE">Cheque</SelectItem>
                      <SelectItem value="TRANSFERENCIA">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {F('Prazo (dias)', 'prazo_dias', { type: 'number' })}
                {F('Qtd. Parcelas', 'qtd_parcelas', { type: 'number' })}
                {F('1º Vencimento', 'primeiro_vencimento', { type: 'date' })}
                {F('Valor Total a Receber', 'valor_total_receber', { mask: 'currency' })}
                {F('Centro de Custo', 'centro_custo')}
                {F('Conta Financeira', 'conta_financeira')}
                {F('Histórico Financeiro', 'historico_financeiro', { cls: 'md:col-span-4' })}
              </div>
              <div className="text-xs text-muted-foreground border-t pt-2">
                Pagador definido em <strong>Partes</strong>: {form.pagador_tipo === 'CIF' ? 'Pago (CIF) — Remetente' : form.pagador_tipo === 'FOB' ? 'À pagar (FOB) — Destinatário' : 'Consignatário'}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMut.isPending}>Criar ORT Manual</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
