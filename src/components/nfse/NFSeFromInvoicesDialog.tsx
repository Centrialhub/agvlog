import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, ArrowRight, ArrowLeft, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useBillingDocuments } from '@/hooks/useBillingDocuments';
import { useClients } from '@/hooks/useClients';
import { useEmitters } from '@/hooks/useEmitters';
import { useCreateNFSe, useIssueNFSe } from '@/hooks/useNFSe';
import { useRecalculateInboundFreight } from '@/hooks/useRecalculateInboundFreight';
import { formatCnpj, validateInsurance } from '@/lib/fiscal/insuranceValidation';
import { hasInsuranceData } from '@/lib/fiscal/insuranceText';
import { Calculator } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SENTINEL_NONE = '__none__';

function num(v: any) { return Number(v ?? 0) || 0; }
function onlyDigits(v: any) { return String(v ?? '').replace(/\D/g, ''); }

export default function NFSeFromInvoicesDialog({ open, onOpenChange }: Props) {
  const { data: clients = [] } = useClients();
  const { data: emitters = [] } = useEmitters();
  const create = useCreateNFSe();
  const issue = useIssueNFSe();
  const recalcFreight = useRecalculateInboundFreight();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [supplierId, setSupplierId] = useState<string>(SENTINEL_NONE);
  const [clientId, setClientId] = useState<string>(SENTINEL_NONE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [recipientCity, setRecipientCity] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Passo 2 — valor de serviço editável por NF (pré-preenchido com o frete)
  const [serviceValues, setServiceValues] = useState<Record<string, number>>({});

  // Step 2 — dados fiscais da NFS-e
  const [emitterId, setEmitterId] = useState<string>('');
  const [aliquotaIss, setAliquotaIss] = useState<number>(5);
  const [issRetido, setIssRetido] = useState(false);
  const [codServico, setCodServico] = useState('');
  const [cnae, setCnae] = useState('');
  const [natOperacao, setNatOperacao] = useState('');
  const [descricao, setDescricao] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [tomadorMode, setTomadorMode] = useState<'remetente' | 'destinatario'>('remetente');
  const [issuing, setIssuing] = useState(false);
  // Retenções e deduções (opcionais)
  const [valorDeducoes, setValorDeducoes] = useState<number>(0);
  const [aliqPis, setAliqPis] = useState<number>(0);
  const [aliqCofins, setAliqCofins] = useState<number>(0);
  const [aliqInss, setAliqInss] = useState<number>(0);
  const [aliqIr, setAliqIr] = useState<number>(0);
  const [aliqCsll, setAliqCsll] = useState<number>(0);
  const [outrasRetencoes, setOutrasRetencoes] = useState<number>(0);
  // Seguro da carga (mesmos campos do CT-e)
  const [insurerName, setInsurerName] = useState('');
  const [insurerCnpj, setInsurerCnpj] = useState('');
  const [insurerPolicy, setInsurerPolicy] = useState('');
  const [insurerEndorsement, setInsurerEndorsement] = useState('');
  const [insuredAmount, setInsuredAmount] = useState<number>(0);
  const [insurancePremium, setInsurancePremium] = useState<number>(0);
  const [observacoes, setObservacoes] = useState('');

  const suppliers = useMemo(() => clients.filter((c: any) => c.is_supplier), [clients]);
  const clientList = useMemo(() => clients.filter((c: any) => c.is_client !== false), [clients]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected({});
    setDescricao('');
    setObservacoes('');
    setServiceValues({});
    const defEm = emitters.find(e => e.active && e.is_default) || emitters.find(e => e.active);
    setEmitterId(defEm?.id || '');
  }, [open, emitters]);

  const filters = useMemo(() => ({
    supplierId: supplierId !== SENTINEL_NONE ? supplierId : null,
    clientId: clientId !== SENTINEL_NONE ? clientId : null,
    periodStart: periodStart || null,
    periodEnd: periodEnd || null,
    invoiceNumber: invoiceNumber || null,
    recipientCity: recipientCity || null,
  }), [supplierId, clientId, periodStart, periodEnd, invoiceNumber, recipientCity]);

  const { data: docs = [], isLoading } = useBillingDocuments(filters);

  const selectedDocs = useMemo(
    () => docs.filter((d: any) => selected[d.id]),
    [docs, selected],
  );

  const valorPorDoc = (d: any) => {
    const override = serviceValues[d.id];
    if (override !== undefined) return num(override);
    return num(d.freight_value ?? d.value ?? d.total_value ?? 0);
  };
  const totalServicos = useMemo(
    () => selectedDocs.reduce((a: number, d: any) => a + valorPorDoc(d), 0),
    [selectedDocs, serviceValues],
  );
  const baseCalculo = +(Math.max(0, totalServicos - num(valorDeducoes))).toFixed(2);
  const valorIss = +(baseCalculo * num(aliquotaIss) / 100).toFixed(2);
  const valorPis = +(baseCalculo * num(aliqPis) / 100).toFixed(2);
  const valorCofins = +(baseCalculo * num(aliqCofins) / 100).toFixed(2);
  const valorInss = +(baseCalculo * num(aliqInss) / 100).toFixed(2);
  const valorIr = +(baseCalculo * num(aliqIr) / 100).toFixed(2);
  const valorCsll = +(baseCalculo * num(aliqCsll) / 100).toFixed(2);
  const totalRetencoes = +(
    (issRetido ? valorIss : 0) + valorPis + valorCofins + valorInss + valorIr + valorCsll + num(outrasRetencoes)
  ).toFixed(2);
  const valorLiquido = +(totalServicos - num(valorDeducoes) - totalRetencoes).toFixed(2);

  const missingFreight = selectedDocs.filter((d: any) => num(d.freight_value) <= 0).length;

  // Pré-preenche o seguro a partir das NFs selecionadas (snapshot da emissão fiscal)
  useEffect(() => {
    const src = selectedDocs.find((d: any) => d.insurer_policy || d.insurer_name || d.insurer_cnpj) as any;
    if (!src) return;
    setInsurerName((v) => v || src.insurer_name || '');
    setInsurerCnpj((v) => v || formatCnpj(src.insurer_cnpj || ''));
    setInsurerPolicy((v) => v || src.insurer_policy || '');
    setInsurerEndorsement((v) => v || src.insurer_endorsement || '');
    setInsuredAmount((v) => v || num(src.insured_amount));
    setInsurancePremium((v) => v || num(src.insurance_premium));
  }, [selectedDocs]);

  const insuranceCheck = useMemo(
    () =>
      hasInsuranceData({
        insurer_name: insurerName,
        insurer_cnpj: insurerCnpj,
        insurer_policy: insurerPolicy,
        insurer_endorsement: insurerEndorsement,
        insured_amount: insuredAmount,
        insurance_premium: insurancePremium,
      })
        ? validateInsurance({ name: insurerName, cnpj: insurerCnpj, policy: insurerPolicy, endorsement: insurerEndorsement })
        : { ok: true, errors: {}, messages: [] },
    [insurerName, insurerCnpj, insurerPolicy, insurerEndorsement, insuredAmount, insurancePremium],
  );

  // Spinner do botão só reflete recálculo manual (clique do usuário).
  // O auto-recálculo em background não deve prender o botão.
  const [manualRecalcing, setManualRecalcing] = useState(false);

  async function handleRecalc() {
    const ids = selectedDocs.map((d: any) => d.id);
    if (!ids.length) { toast.error('Selecione ao menos uma NF para recalcular'); return; }
    setManualRecalcing(true);
    try {
      const res = await recalcFreight.mutateAsync(ids);
      toast.success(`Frete recalculado: ${res.updated} atualizadas, ${res.skipped} com override, ${res.failed} falharam`);
    } finally {
      setManualRecalcing(false);
    }
  }

  // Recálculo de frete é somente manual (botão "Recalcular frete").
  // Auto-recálculo em background foi removido para não bloquear a função quando
  // o usuário precisa dispará-la em NFs específicas (ex.: uma NF sem frete).

  const toggleAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    if (v) docs.forEach((d: any) => { next[d.id] = true; });
    setSelected(next);
  };

  // Deriva tomador a partir das NFs selecionadas
  const tomador = useMemo(() => {
    if (!selectedDocs.length) return null;
    const key = tomadorMode === 'remetente' ? 'remitter' : 'recipient_name';
    const cnpjKey = tomadorMode === 'remetente' ? 'remitter_cnpj' : 'recipient_cnpj';
    const first = selectedDocs[0] as any;
    
    // Tenta casar com um cliente cadastrado pelo CNPJ para pegar endereço/IE
    const cnpjDigits = onlyDigits(first[cnpjKey]);
    const match = clients.find((c: any) => onlyDigits(c.tax_id) === cnpjDigits);
    
    // Fallback para os dados da própria NF (OCR/XML) quando o cadastro está incompleto
    const municipio = (match?.address_city || first.recipient_city || first.remitter_city || '').trim();
    const uf = (match?.address_state || first.recipient_state || first.remitter_state || '').trim();
    const zipRaw = onlyDigits(zip);
    const municipioCod = match?.city_ibge || null;

    return {
      nome: (match?.company_name || first[key] || '') as string,
      cnpj: cnpjDigits,
      ie: (match?.state_registration || '') as string,
      endereco: (match?.address_street || '') as string,
      bairro: (match?.address_neighborhood || '') as string,
      municipio,
      municipio_cod: municipioCod,
      uf,
      cep: zipRaw ? zipRaw.slice(0, 8).padStart(8, '0') : '',
      cliente_id: match?.id || null,
    };
  }, [selectedDocs, tomadorMode, clients]);

  const allSameTomador = useMemo(() => {
    if (selectedDocs.length < 2) return true;
    const key = tomadorMode === 'remetente' ? 'remitter_cnpj' : 'recipient_cnpj';
    const first = onlyDigits((selectedDocs[0] as any)[key]);
    return selectedDocs.every((d: any) => onlyDigits(d[key]) === first);
  }, [selectedDocs, tomadorMode]);

  const canAdvance = selectedDocs.length > 0 && allSameTomador;

  const handleEmit = async () => {
    if (!emitterId) { toast.error('Selecione o emitente fiscal'); return; }
    if (!tomador?.cnpj) { toast.error('Tomador sem CNPJ — cadastre o cliente/fornecedor'); return; }
    if (totalServicos <= 0) { toast.error('Valor de serviços deve ser maior que zero'); return; }
    if (!insuranceCheck.ok) { toast.error(`Seguro: ${insuranceCheck.messages.join(' ')}`); return; }

    setIssuing(true);
    try {
      const fdIds = selectedDocs.map((d: any) => d.id);
      const description = (descricao?.trim() ||
        `Prestacao de servico de transporte referente a ${fdIds.length} NF(s): ` +
        selectedDocs.map((d: any) => `NF ${d.invoice_number || d.access_key?.slice(-9)}`).join(', '))
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove acentos para evitar rejeição em provedores legados

      const created = await create.mutateAsync({
        emitter_id: emitterId,
        issue_date: issueDate,
        cliente_id: tomador.cliente_id,
        cliente_nome: tomador.nome,
        cliente_cnpj: tomador.cnpj,
        cliente_ie: tomador.ie,
        cliente_endereco: tomador.endereco,
        cliente_bairro: tomador.bairro,
        cliente_municipio: tomador.municipio,
        cliente_uf: tomador.uf,
        cliente_cep: tomador.cep || null,
        cliente_cod_municipio: tomador.municipio_cod,
        description,
        aliquota_iss: aliquotaIss,
        iss_retido: issRetido,
        cod_servico: codServico || undefined,
        cnae: cnae || undefined,
        nat_operacao: natOperacao || undefined,
        valor_servicos: totalServicos,
        base_calculo: baseCalculo,
        valor_iss: valorIss,
        valor_liquido: valorLiquido,
        valor_total: totalServicos,
        valor_deducoes: num(valorDeducoes),
        valor_pis: valorPis,
        valor_cofins: valorCofins,
        valor_inss: valorInss,
        valor_ir: valorIr,
        valor_csll: valorCsll,
        outras_retencoes: num(outrasRetencoes),
        insurer_name: insurerName.trim() || null,
        insurer_cnpj: insurerCnpj.replace(/\D/g, '') || null,
        insurer_policy: insurerPolicy.trim() || null,
        insurer_endorsement: insurerEndorsement.trim() || null,
        insured_amount: num(insuredAmount) || null,
        insurance_premium: num(insurancePremium) || null,
        items: selectedDocs.map((d: any) => ({
          description: `NF ${d.invoice_number || ''} — ${d.remitter || ''}`.trim(),
          quantity: 1,
          unit_value: valorPorDoc(d),
          total: valorPorDoc(d),
          fiscal_document_id: d.id,
          access_key: d.access_key,
        })),
        fiscal_document_ids: fdIds,
        notes: observacoes.trim() || undefined,
      } as any);

      toast.success(`RPS ${created.rps_number} criado — enviando ao Hub Fiscal…`);
      try {
        await issue.mutateAsync(created.id);
      } catch (e: any) {
        toast.error(`NFS-e criada mas emissão falhou: ${e?.message || ''}`);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao criar NFS-e');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Emitir NFS-e a partir de NFs {step === 1 ? '— 1. Selecionar notas' : step === 2 ? '— 2. Valores por NF' : '— 3. Dados fiscais e emissão'}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-2">
                <Label>Fornecedor / Remetente</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                    {suppliers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Cliente / Destinatário</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                    {clientList.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Cidade Destino</Label>
                <Input 
                  placeholder="Filtrar por cidade..." 
                  value={recipientCity} 
                  onChange={e => setRecipientCity(e.target.value)} 
                />
              </div>
              <div><Label>Nº NF</Label><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
              <div><Label>Emissão de</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
              <div><Label>até</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
            </div>

            <div className="text-xs text-muted-foreground">
              Somente NFs de entrada não faturadas (sem CT-e nem NFS-e emitidos).
            </div>

            <div className="rounded-md border max-h-[52vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={docs.length > 0 && selectedDocs.length === docs.length}
                        onCheckedChange={v => toggleAll(!!v)}
                      />
                    </TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Remetente</TableHead>
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Valor NF</TableHead>
                    <TableHead className="text-right">Frete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
                  {!isLoading && docs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma NF disponível</TableCell></TableRow>
                  )}
                  {docs.map((d: any) => (
                    <TableRow key={d.id} className={selected[d.id] ? 'bg-muted/40' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[d.id]}
                          onCheckedChange={v => setSelected(s => ({ ...s, [d.id]: !!v }))}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.invoice_number || d.access_key?.slice(-9) || '—'}</TableCell>
                      <TableCell className="text-xs">{d.issue_date}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{d.remitter || '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{d.recipient || d.recipient_name || '—'}</TableCell>
                      <TableCell className="text-xs">{d.recipient_city ? `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {num(d.value ?? d.total_value).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {num(d.freight_value).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {selectedDocs.length > 0 && !allSameTomador && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                As NFs selecionadas têm {tomadorMode === 'remetente' ? 'remetentes' : 'destinatários'} diferentes.
                O tomador de uma NFS-e precisa ser único — ajuste a seleção ou troque o tipo de tomador.
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm">
                <Badge variant="secondary">{selectedDocs.length} NF(s)</Badge>{' '}
                <span className="text-muted-foreground">Total frete: </span>
                <span className="font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</span>
                {missingFreight > 0 && (
                  <span className="ml-2 text-xs text-yellow-600">
                    ({missingFreight} sem frete — recalcule pela tabela)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRecalc}
                  disabled={manualRecalcing || docs.length === 0}
                  title="Recalcula o frete de TODAS as NFs listadas usando a tabela de frete vigente"
                >
                  {manualRecalcing
                    ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    : <Calculator className="h-4 w-4 mr-1" />}
                  Recalcular frete
                </Button>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Tomador é:</Label>
                  <Select value={tomadorMode} onValueChange={(v: any) => setTomadorMode(v)}>
                    <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remetente">Remetente</SelectItem>
                      <SelectItem value="destinatario">Destinatário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    // Pré-preenche valor de serviço com o frete atual de cada NF selecionada
                    setServiceValues(prev => {
                      const next = { ...prev };
                      selectedDocs.forEach((d: any) => {
                        if (next[d.id] === undefined) {
                          next[d.id] = num(d.freight_value ?? d.value ?? d.total_value ?? 0);
                        }
                      });
                      return next;
                    });
                    setStep(2);
                    // Preenche observações automaticamente ao avançar
                    const nfList = selectedDocs.map((d: any) => d.invoice_number || d.access_key?.slice(-9)).join(', ');
                    setObservacoes(`NFS-e referente a(s) NF ${nfList}`);
                  }}
                  disabled={!canAdvance}
                >
                  Avançar <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Ajuste, se necessário, o valor de serviço de cada NF selecionada. O valor vem pré-preenchido a partir do frete calculado automaticamente.
            </div>
            <div className="border rounded-md max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">NF</th>
                    <th className="text-left p-2">Remetente</th>
                    <th className="text-left p-2">Destinatário</th>
                    <th className="text-right p-2">Frete calc.</th>
                    <th className="text-right p-2 w-40">Vl. Serviço (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDocs.map((d: any) => {
                    const freteCalc = num(d.freight_value ?? 0);
                    const val = serviceValues[d.id] ?? freteCalc;
                    return (
                      <tr key={d.id} className="border-t">
                        <td className="p-2 font-mono">{d.invoice_number || d.access_key?.slice(-9)}</td>
                        <td className="p-2">{d.remitter || '—'}</td>
                        <td className="p-2">{d.recipient || d.recipient_name || '—'}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">R$ {freteCalc.toFixed(2)}</td>
                        <td className="p-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 text-right"
                            value={val}
                            onChange={e => setServiceValues(prev => ({ ...prev, [d.id]: +e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 border-t">
                    <td colSpan={3} className="p-2 text-right font-semibold">Total serviços</td>
                    <td className="p-2"></td>
                    <td className="p-2 text-right font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <div className="font-semibold">Tomador do serviço</div>
              <div>{tomador?.nome} — CNPJ {tomador?.cnpj}</div>
              {tomador?.endereco && <div className="text-muted-foreground">{tomador.endereco}, {tomador.bairro} — {tomador.municipio}/{tomador.uf}</div>}
              <div className="text-xs text-muted-foreground pt-1">Baseado em {selectedDocs.length} NF(s) — total R$ {totalServicos.toFixed(2)}</div>
            </div>

            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3">
                <Label>Emitente Fiscal</Label>
                <Select value={emitterId} onValueChange={setEmitterId}>
                  <SelectTrigger><SelectValue placeholder={emitters.length ? 'Selecione' : 'Cadastre em Configurações'} /></SelectTrigger>
                  <SelectContent>
                    {emitters.filter(e => e.active).map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.razao_social} — CNPJ {e.cnpj}{e.is_default ? ' (padrão)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Data emissão</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
              <div><Label>Alíquota ISS (%)</Label><Input type="number" step="0.0001" value={aliquotaIss} onChange={e => setAliquotaIss(+e.target.value)} /></div>
              <div className="flex items-end gap-2"><Checkbox checked={issRetido} onCheckedChange={v => setIssRetido(!!v)} /><Label>ISS Retido</Label></div>

              <div className="col-span-2"><Label>Cód. Serviço</Label><Input value={codServico} onChange={e => setCodServico(e.target.value)} /></div>
              <div className="col-span-2"><Label>CNAE</Label><Input value={cnae} onChange={e => setCnae(e.target.value)} /></div>
              <div className="col-span-2"><Label>Nat. Operação</Label><Input value={natOperacao} onChange={e => setNatOperacao(e.target.value)} /></div>

              <div className="col-span-6">
                <Label>Discriminação dos Serviços</Label>
                <Textarea rows={4} value={descricao} onChange={e => setDescricao(e.target.value)}
                  placeholder={`Prestação de serviço de transporte referente a ${selectedDocs.length} NF(s)…`} />
              </div>
              <div className="col-span-6">
                <Label>Observações / Notas</Label>
                <Textarea 
                  rows={2} 
                  value={observacoes} 
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Observações que constarão na nota…"
                />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">Retenções e deduções (opcionais)</div>
              <div className="grid grid-cols-6 gap-3">
                <div>
                  <Label className="text-xs">Deduções (R$)</Label>
                  <Input type="number" step="0.01" value={valorDeducoes} onChange={e => setValorDeducoes(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">PIS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqPis} onChange={e => setAliqPis(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">COFINS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqCofins} onChange={e => setAliqCofins(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">INSS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqInss} onChange={e => setAliqInss(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">IR (%)</Label>
                  <Input type="number" step="0.0001" value={aliqIr} onChange={e => setAliqIr(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">CSLL (%)</Label>
                  <Input type="number" step="0.0001" value={aliqCsll} onChange={e => setAliqCsll(+e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Outras retenções (R$)</Label>
                  <Input type="number" step="0.01" value={outrasRetencoes} onChange={e => setOutrasRetencoes(+e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3 pt-2 border-t text-xs">
                <div><div className="text-muted-foreground">PIS</div><div className="font-medium tabular-nums">R$ {valorPis.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">COFINS</div><div className="font-medium tabular-nums">R$ {valorCofins.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">INSS</div><div className="font-medium tabular-nums">R$ {valorInss.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">IR</div><div className="font-medium tabular-nums">R$ {valorIr.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">CSLL</div><div className="font-medium tabular-nums">R$ {valorCsll.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">Retenções (total)</div><div className="font-semibold tabular-nums">R$ {totalRetencoes.toFixed(2)}</div></div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Seguro da carga (impresso na discriminação da NFS-e)
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Seguradora</Label>
                  <Input value={insurerName} onChange={e => setInsurerName(e.target.value)} />
                  {insuranceCheck.errors.name && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.name}</p>}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">CNPJ da seguradora</Label>
                  <Input value={insurerCnpj} onChange={e => setInsurerCnpj(formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
                  {insuranceCheck.errors.cnpj && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.cnpj}</p>}
                </div>
                <div>
                  <Label className="text-xs">Apólice</Label>
                  <Input value={insurerPolicy} onChange={e => setInsurerPolicy(e.target.value)} />
                  {insuranceCheck.errors.policy && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.policy}</p>}
                </div>
                <div>
                  <Label className="text-xs">Averbação</Label>
                  <Input value={insurerEndorsement} onChange={e => setInsurerEndorsement(e.target.value)} />
                  {insuranceCheck.errors.endorsement && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.endorsement}</p>}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Valor segurado (R$)</Label>
                  <Input type="number" step="0.01" value={insuredAmount} onChange={e => setInsuredAmount(+e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Prêmio do seguro (R$)</Label>
                  <Input type="number" step="0.01" value={insurancePremium} onChange={e => setInsurancePremium(+e.target.value)} />
                </div>
              </div>
            </div>

            {totalServicos <= 0 && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-800">
                Valor de serviços está zerado. Volte ao passo 1 e clique em <strong>Recalcular frete</strong> para calcular
                a partir da tabela de frete das NFs selecionadas.
              </div>
            )}

            <div className="rounded-md border p-3 grid grid-cols-4 gap-3 bg-muted/30">
              <div><div className="text-xs text-muted-foreground">Vl. Serviços</div><div className="font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Base Cálculo</div><div className="font-semibold tabular-nums">R$ {baseCalculo.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. ISS</div><div className="font-semibold tabular-nums">R$ {valorIss.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. Líquido</div><div className="font-semibold tabular-nums">R$ {valorLiquido.toFixed(2)}</div></div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((step - 1) as 1 | 2)} disabled={issuing}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={issuing}>Cancelar</Button>
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={totalServicos <= 0}>
              Avançar <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={handleEmit} disabled={issuing || create.isPending || issue.isPending}>
              {issuing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Emitir NFS-e
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}