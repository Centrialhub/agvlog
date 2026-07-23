import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { Client } from '@/hooks/useClients';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

const UF_OPTIONS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const empty = {
  company_name: '', trade_name: '', legal_name: '', tax_id: '', person_type: 'CNPJ',
  state_registration: '', municipal_registration: '', ie_indicator: 'Contribuinte ICMS',
  internal_code: '', sigla: '', category: '', cfop_client_type: 'Comércio',
  tax_regime: 'Outros', payer_group: '', payer: '', freight_calc_type: '',
  cubage_factor: '', accounting_code_client: '', accounting_code_supplier: '',
  budget_group_client: '', budget_group_supplier: '', client_type: '',
  country_code: '1058', country_name: 'BRASIL',
  address_street: '', address_number: '', address_complement: '', address_neighborhood: '',
  address_city: '', address_state: '', address_zip: '',
  contact_name: '', email: '', phone: '', mobile: '', fax: '',
  blocked: false, billed: false, taxes_enabled: false,
  tax_code: '', tax_description: '',
  service_notes: '', payment_notes: '', notes: '',
  is_rural: false, rural_notes: '', rural_driver_instructions: '',
  rural_requires_contact: false, rural_contact_name: '', rural_contact_phone: '',
  rural_access_type: '', rural_delivery_difficulty: '',
  is_client: true, is_supplier: false,
};

type FormState = typeof empty;

function clientToForm(c?: Client | null): FormState {
  if (!c) return { ...empty };
  return {
    ...empty,
    ...Object.fromEntries(Object.entries(c).filter(([k]) => k in empty).map(([k, v]) => [k, v ?? (typeof (empty as any)[k] === 'boolean' ? false : '')])),
  } as FormState;
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function ClientFormDialog({
  open, onOpenChange, client, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client | null;
  onSave: (values: any) => Promise<void> | void;
}) {
  const [form, setForm] = useState<FormState>(clientToForm(client));
  const [lookupLoading, setLookupLoading] = useState(false);
  const { toast } = useToast();
  const { currentTenant } = useTenant();

  useEffect(() => { setForm(clientToForm(client)); }, [client, open]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // Tabelas de frete já cadastradas para esse cliente (auto-aparecem ao digitar grupo pagador)
  const { data: freightTables = [] } = useQuery({
    queryKey: ['client_freight_tables', currentTenant?.id, client?.id, form.payer_group, form.tax_id],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('freight_tables')
        .select('id, table_name, table_code, payer_group, payer, origin_state, destination_state, fixed_value, rate_percent, min_value, valid_from, valid_until, blocked')
        .eq('tenant_id', currentTenant.id)
        .eq('blocked', false)
        .order('table_name')
        .limit(50);
      if (client?.id) {
        q = q.or(`client_id.eq.${client.id},payer_group.ilike.%${form.payer_group || ''}%`);
      } else if (form.payer_group) {
        q = q.ilike('payer_group', `%${form.payer_group}%`);
      } else {
        return [];
      }
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    },
    enabled: open && !!currentTenant && (!!client?.id || !!form.payer_group),
  });

  // Busca CNPJ na BrasilAPI (cruza dados e preenche campos)
  const lookupCnpj = async () => {
    const digits = onlyDigits(form.tax_id);
    if (digits.length !== 14) {
      toast({ title: 'CNPJ inválido', description: 'Informe os 14 dígitos do CNPJ.', variant: 'destructive' });
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) throw new Error('CNPJ não encontrado');
      const d = await res.json();
      setForm(prev => ({
        ...prev,
        company_name: prev.company_name || d.nome_fantasia || d.razao_social || '',
        legal_name: d.razao_social || prev.legal_name,
        trade_name: d.nome_fantasia || prev.trade_name,
        email: prev.email || d.email || '',
        phone: prev.phone || (d.ddd_telefone_1 ? d.ddd_telefone_1 : ''),
        address_street: d.logradouro || prev.address_street,
        address_number: d.numero || prev.address_number,
        address_complement: d.complemento || prev.address_complement,
        address_neighborhood: d.bairro || prev.address_neighborhood,
        address_city: d.municipio || prev.address_city,
        address_state: d.uf || prev.address_state,
        address_zip: d.cep ? String(d.cep).replace(/(\d{5})(\d{3})/, '$1-$2') : prev.address_zip,
        person_type: 'CNPJ',
      }));
      toast({ title: 'CNPJ consultado', description: `${d.razao_social} — dados preenchidos.` });
    } catch (e: any) {
      toast({ title: 'Falha na consulta', description: e.message, variant: 'destructive' });
    } finally {
      setLookupLoading(false);
    }
  };

  // Busca CEP via ViaCEP/BrasilAPI
  const lookupCep = async () => {
    const digits = onlyDigits(form.address_zip);
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
      if (!res.ok) return;
      const d = await res.json();
      setForm(prev => ({
        ...prev,
        address_street: prev.address_street || d.street || '',
        address_neighborhood: prev.address_neighborhood || d.neighborhood || '',
        address_city: prev.address_city || d.city || '',
        address_state: prev.address_state || d.state || '',
      }));
    } catch {}
  };

  const handleSubmit = async () => {
    if (!form.company_name.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    const payload: any = { ...form };
    payload.cubage_factor = form.cubage_factor === '' ? null : Number(form.cubage_factor);
    // Sanitiza vazios para null
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
    await onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? `Editar Cliente — ${client.company_name}` : 'Novo Cliente'}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="geral" className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="endereco">Endereço</TabsTrigger>
            <TabsTrigger value="contato">Contato</TabsTrigger>
            <TabsTrigger value="tributario">Tributário</TabsTrigger>
            <TabsTrigger value="cobranca">Cobrança / Frete</TabsTrigger>
            <TabsTrigger value="rural">Zona Rural</TabsTrigger>
            <TabsTrigger value="obs">Observações</TabsTrigger>
          </TabsList>

          {/* GERAL */}
          <TabsContent value="geral" className="space-y-4 pt-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-2">
                <Label>Tipo</Label>
                <Select value={form.person_type} onValueChange={v => set('person_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNPJ">CNPJ</SelectItem>
                    <SelectItem value="CPF">CPF</SelectItem>
                    <SelectItem value="EX">Estrangeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label>CNPJ / CPF</Label>
                <div className="flex gap-2">
                  <Input value={form.tax_id} onChange={e => set('tax_id', e.target.value)} placeholder="00.000.000/0000-00" />
                  <Button type="button" variant="outline" size="icon" onClick={lookupCnpj} disabled={lookupLoading} title="Consultar CNPJ na Receita">
                    {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="col-span-3">
                <Label>Inscrição Estadual</Label>
                <Input value={form.state_registration} onChange={e => set('state_registration', e.target.value)} />
              </div>
              <div className="col-span-3">
                <Label>Ind. IE Dest.</Label>
                <Select value={form.ie_indicator} onValueChange={v => set('ie_indicator', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Contribuinte ICMS">Contribuinte ICMS</SelectItem>
                    <SelectItem value="Isento">Isento</SelectItem>
                    <SelectItem value="Não Contribuinte">Não Contribuinte</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-6">
                <Label>Razão Social</Label>
                <Input value={form.legal_name} onChange={e => set('legal_name', e.target.value)} />
              </div>
              <div className="col-span-6">
                <Label>Nome Fantasia *</Label>
                <Input value={form.company_name} onChange={e => set('company_name', e.target.value)} />
              </div>

              <div className="col-span-3">
                <Label>Código Interno</Label>
                <Input value={form.internal_code} onChange={e => set('internal_code', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Sigla</Label>
                <Input value={form.sigla} onChange={e => set('sigla', e.target.value)} />
              </div>
              <div className="col-span-3">
                <Label>Categoria</Label>
                <Input value={form.category} onChange={e => set('category', e.target.value)} placeholder="Cliente / Fornecedor" />
              </div>
              <div className="col-span-2">
                <Label>Insc. Municipal</Label>
                <Input value={form.municipal_registration} onChange={e => set('municipal_registration', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Fator Cubagem</Label>
                <Input type="number" value={form.cubage_factor} onChange={e => set('cubage_factor', e.target.value)} placeholder="300" />
              </div>

              <div className="col-span-4 flex items-center gap-3 pt-2">
                <Switch checked={form.blocked} onCheckedChange={v => set('blocked', v)} />
                <Label className="cursor-pointer">Bloqueado</Label>
              </div>
              <div className="col-span-4 flex items-center gap-3 pt-2">
                <Switch checked={form.billed} onCheckedChange={v => set('billed', v)} />
                <Label className="cursor-pointer">Faturado</Label>
              </div>
              <div className="col-span-4 flex items-center gap-3 pt-2">
                <Switch checked={form.taxes_enabled} onCheckedChange={v => set('taxes_enabled', v)} />
                <Label className="cursor-pointer">Taxas habilitadas</Label>
              </div>
              <div className="col-span-12 rounded-md border border-border bg-muted/30 p-3 mt-2">
                <Label className="text-xs uppercase text-muted-foreground">Tipo de cadastro</Label>
                <div className="flex flex-wrap gap-6 mt-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.is_client} onCheckedChange={v => set('is_client', v)} />
                    <Label className="cursor-pointer">É cliente</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.is_supplier} onCheckedChange={v => set('is_supplier', v)} />
                    <Label className="cursor-pointer">É fornecedor</Label>
                  </div>
                  <p className="text-xs text-muted-foreground self-center">
                    Fornecedores são vinculados automaticamente às notas fiscais pelo CNPJ do remetente.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ENDEREÇO */}
          <TabsContent value="endereco" className="space-y-4 pt-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label>CEP</Label>
                <div className="flex gap-2">
                  <Input value={form.address_zip} onChange={e => set('address_zip', e.target.value)} onBlur={lookupCep} placeholder="00000-000" />
                </div>
              </div>
              <div className="col-span-7">
                <Label>Endereço</Label>
                <Input value={form.address_street} onChange={e => set('address_street', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Nº</Label>
                <Input value={form.address_number} onChange={e => set('address_number', e.target.value)} />
              </div>

              <div className="col-span-4">
                <Label>Complemento</Label>
                <Input value={form.address_complement} onChange={e => set('address_complement', e.target.value)} />
              </div>
              <div className="col-span-4">
                <Label>Bairro</Label>
                <Input value={form.address_neighborhood} onChange={e => set('address_neighborhood', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>UF</Label>
                <Select value={form.address_state} onValueChange={v => set('address_state', v)}>
                  <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>
                    {UF_OPTIONS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>País</Label>
                <Input value={form.country_name} onChange={e => set('country_name', e.target.value)} />
              </div>

              <div className="col-span-6">
                <Label>Município</Label>
                <Input value={form.address_city} onChange={e => set('address_city', e.target.value)} />
              </div>
              <div className="col-span-3">
                <Label>Cód. País</Label>
                <Input value={form.country_code} onChange={e => set('country_code', e.target.value)} />
              </div>
            </div>
          </TabsContent>

          {/* CONTATO */}
          <TabsContent value="contato" className="space-y-4 pt-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label>Nome do Contato</Label>
                <Input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
              </div>
              <div className="col-span-6">
                <Label>E-mail</Label>
                <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="col-span-4">
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(34) 3233-9000" />
              </div>
              <div className="col-span-4">
                <Label>Celular</Label>
                <Input value={form.mobile} onChange={e => set('mobile', e.target.value)} />
              </div>
              <div className="col-span-4">
                <Label>Fax</Label>
                <Input value={form.fax} onChange={e => set('fax', e.target.value)} />
              </div>
            </div>
          </TabsContent>

          {/* TRIBUTÁRIO */}
          <TabsContent value="tributario" className="space-y-4 pt-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <Label>Tipo Cliente CFOP</Label>
                <Select value={form.cfop_client_type} onValueChange={v => set('cfop_client_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Comércio">Comércio</SelectItem>
                    <SelectItem value="Indústria">Indústria</SelectItem>
                    <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                    <SelectItem value="Produtor Rural">Produtor Rural</SelectItem>
                    <SelectItem value="Serviço">Serviço</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label>Regime Tributário</Label>
                <Select value={form.tax_regime} onValueChange={v => set('tax_regime', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
                    <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
                    <SelectItem value="Lucro Real">Lucro Real</SelectItem>
                    <SelectItem value="MEI">MEI</SelectItem>
                    <SelectItem value="Outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label>Tipo de Cliente</Label>
                <Input value={form.client_type} onChange={e => set('client_type', e.target.value)} placeholder="COM. DIVERSOS" />
              </div>

              <div className="col-span-2">
                <Label>Cód. Imposto</Label>
                <Input value={form.tax_code} onChange={e => set('tax_code', e.target.value)} placeholder="I0" />
              </div>
              <div className="col-span-4">
                <Label>Descrição</Label>
                <Input value={form.tax_description} onChange={e => set('tax_description', e.target.value)} placeholder="Isento" />
              </div>
              <div className="col-span-3">
                <Label>Cód. Contábil Cli.</Label>
                <Input value={form.accounting_code_client} onChange={e => set('accounting_code_client', e.target.value)} />
              </div>
              <div className="col-span-3">
                <Label>Cód. Contábil For.</Label>
                <Input value={form.accounting_code_supplier} onChange={e => set('accounting_code_supplier', e.target.value)} />
              </div>
              <div className="col-span-6">
                <Label>Grupo Orc. Cli.</Label>
                <Input value={form.budget_group_client} onChange={e => set('budget_group_client', e.target.value)} placeholder="CLI007 — CLIENTES DIVERSOS" />
              </div>
              <div className="col-span-6">
                <Label>Grupo Orc. For.</Label>
                <Input value={form.budget_group_supplier} onChange={e => set('budget_group_supplier', e.target.value)} placeholder="FOR007 — FORNECEDORES DIVERSOS" />
              </div>
            </div>
          </TabsContent>

          {/* COBRANÇA / FRETE */}
          <TabsContent value="cobranca" className="space-y-4 pt-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label>Grupo Pagador</Label>
                <Input
                  value={form.payer_group}
                  onChange={e => set('payer_group', e.target.value)}
                  placeholder="Ex.: TABELA ALIANÇA GO"
                  list="payer-group-list"
                />
              </div>
              <div className="col-span-6">
                <Label>Pagador</Label>
                <Input value={form.payer} onChange={e => set('payer', e.target.value)} />
              </div>
              <div className="col-span-6">
                <Label>Tipo Cálculo Frete</Label>
                <Select value={form.freight_calc_type} onValueChange={v => set('freight_calc_type', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="por_peso">Por Peso (R$/kg)</SelectItem>
                    <SelectItem value="por_pallet">Por Pallet</SelectItem>
                    <SelectItem value="percentual">Percentual sobre NF</SelectItem>
                    <SelectItem value="fixo">Valor Fixo</SelectItem>
                    <SelectItem value="tabela">Tabela vinculada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lista de tabelas de frete relacionadas — aparece automaticamente */}
            <div className="rounded-md border">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Tabelas de Frete vinculadas
                </div>
                <Badge variant="outline">{freightTables.length}</Badge>
              </div>
              {freightTables.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Digite o Grupo Pagador acima para listar tabelas, ou cadastre em Frete → Tabelas.
                </div>
              ) : (
                <div className="divide-y max-h-56 overflow-y-auto">
                  {freightTables.map((t: any) => (
                    <div key={t.id} className="px-3 py-2 text-xs flex items-center justify-between hover:bg-muted/40">
                      <div>
                        <div className="font-medium">{t.table_name} <span className="text-muted-foreground">({t.table_code || '—'})</span></div>
                        <div className="text-muted-foreground">
                          {t.payer_group || '—'} · {t.origin_state || '—'}→{t.destination_state || '—'}
                        </div>
                      </div>
                      <div className="text-right">
                        {t.fixed_value ? <div>R$ {Number(t.fixed_value).toFixed(2)}</div> : null}
                        {t.rate_percent ? <div>{Number(t.rate_percent).toFixed(2)}%</div> : null}
                        {t.min_value ? <div className="text-muted-foreground">mín R$ {Number(t.min_value).toFixed(2)}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* OBSERVAÇÕES */}
          <TabsContent value="obs" className="space-y-4 pt-4">
            <div>
              <Label>Notas de Serviço</Label>
              <Textarea rows={3} value={form.service_notes} onChange={e => set('service_notes', e.target.value)} />
            </div>
            <div>
              <Label>Notas de Pagamento / Prazo</Label>
              <Textarea rows={3} value={form.payment_notes} onChange={e => set('payment_notes', e.target.value)} />
            </div>
            <div>
              <Label>Observações Gerais</Label>
              <Textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </TabsContent>
          {/* ZONA RURAL */}
          <TabsContent value="rural" className="space-y-4 pt-4">
            <div className="flex items-center gap-3 rounded-md border p-3 bg-muted/30">
              <Switch checked={form.is_rural} onCheckedChange={v => set('is_rural', v)} />
              <div>
                <Label className="cursor-pointer">Cliente de Zona Rural</Label>
                <p className="text-xs text-muted-foreground">Ao marcar, a carga/viagem exibirá alertas e instruções ao motorista.</p>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <Label>Tipo de Acesso</Label>
                <Select value={form.rural_access_type || ''} onValueChange={v => set('rural_access_type', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paved">Asfalto</SelectItem>
                    <SelectItem value="dirt_road">Estrada de terra</SelectItem>
                    <SelectItem value="mixed">Misto</SelectItem>
                    <SelectItem value="unknown">Desconhecido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label>Dificuldade</Label>
                <Select value={form.rural_delivery_difficulty || ''} onValueChange={v => set('rural_delivery_difficulty', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4 flex items-center gap-3 pt-6">
                <Switch checked={form.rural_requires_contact} onCheckedChange={v => set('rural_requires_contact', v)} />
                <Label className="cursor-pointer">Precisa ligar antes</Label>
              </div>
              <div className="col-span-6">
                <Label>Nome do Contato Rural</Label>
                <Input value={form.rural_contact_name} onChange={e => set('rural_contact_name', e.target.value)} />
              </div>
              <div className="col-span-6">
                <Label>Telefone do Contato Rural</Label>
                <Input value={form.rural_contact_phone} onChange={e => set('rural_contact_phone', e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="col-span-12">
                <Label>Observações visíveis ao motorista</Label>
                <Textarea rows={3} value={form.rural_driver_instructions}
                  onChange={e => set('rural_driver_instructions', e.target.value)}
                  placeholder="Ex.: Ligar antes; entrega em Mamonas; estrada de terra 12km após o trevo." />
                <p className="text-xs text-muted-foreground mt-1">Estas instruções aparecem no app do motorista, romaneio e manifesto.</p>
              </div>
              <div className="col-span-12">
                <Label>Observações internas (não vão para o motorista)</Label>
                <Textarea rows={2} value={form.rural_notes}
                  onChange={e => set('rural_notes', e.target.value)}
                  placeholder="Ex.: cliente sempre demora a pagar táxi." />
              </div>
            </div>
            {form.is_rural && form.rural_requires_contact && !form.rural_contact_phone.trim() && (
              <p className="text-xs text-destructive">⚠️ Marcado "ligar antes" mas sem telefone.</p>
            )}
            {form.is_rural && !form.rural_driver_instructions.trim() && (
              <p className="text-xs text-warning">⚠️ Recomendado preencher instrução para o motorista.</p>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}