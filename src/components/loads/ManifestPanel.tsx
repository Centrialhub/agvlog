import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSignature, Send, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  loadId: string;
  loadNumber: string;
  origin?: string | null;
  destination?: string | null;
}

const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export default function ManifestPanel({ loadId, loadNumber, origin, destination }: Props) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Load CT-es for this load
  const { data: ctes = [] } = useQuery({
    queryKey: ['load_ctes', loadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cte_documents')
        .select('id, cte_number, cte_series, access_key, fiscal_document_ids, recipient, recipient_city, recipient_state, freight_value, cargo_value, weight_kg, status, is_voided')
        .contains('load_ids', [loadId]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!loadId,
  });

  // NF-e ids referenced by CT-es (exclude ORT-only / non-fiscal)
  const nfeIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of ctes as any[]) {
      if (c.is_voided) continue;
      for (const id of (c.fiscal_document_ids || [])) set.add(id);
    }
    return Array.from(set);
  }, [ctes]);

  const { data: nfes = [] } = useQuery({
    queryKey: ['manifest_nfes', loadId, nfeIds],
    enabled: nfeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, recipient, recipient_city, recipient_state, weight_kg, value, pallet_count, operation_type')
        .in('id', nfeIds);
      if (error) throw error;
      return data || [];
    },
  });

  // ORT count for awareness
  const { data: ortCount = 0 } = useQuery({
    queryKey: ['load_ort_count', loadId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('fiscal_documents')
        .select('id', { count: 'exact', head: true })
        .eq('load_id', loadId)
        .eq('document_type', 'inbound');
      if (error) throw error;
      const totalNfe = count || 0;
      return Math.max(0, totalNfe - nfeIds.length);
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['load_manifest', loadId],
    queryFn: async () => {
      const { data } = await supabase
        .from('load_manifests')
        .select('*')
        .eq('load_id', loadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const [form, setForm] = useState({
    manifest_number: '',
    responsible_name: '',
    responsible_cnpj: '',
    responsible_ie: '',
    responsible_address: '',
    responsible_neighborhood: '',
    responsible_city: '',
    receipt_number: '',
    toll_value: '',
    origin: origin || '',
    destination: destination || '',
    uf_route: '',
    observations: '',
  });

  const totals = useMemo(() => ({
    nfeCount: nfes.length,
    cteCount: ctes.filter((c: any) => !c.is_voided).length,
    value: nfes.reduce((s: number, d: any) => s + Number(d.value || 0), 0),
    weight: nfes.reduce((s: number, d: any) => s + Number(d.weight_kg || 0), 0),
    pallets: nfes.reduce((s: number, d: any) => s + Number(d.pallet_count || 0), 0),
    freight: ctes.filter((c: any) => !c.is_voided).reduce((s: number, c: any) => s + Number(c.freight_value || 0), 0),
  }), [nfes, ctes]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!currentTenant) throw new Error('Tenant não definido');
      if (totals.nfeCount === 0) throw new Error('Nenhuma NF-e com CT-e vinculada para emitir o manifesto');
      const manifest_number = form.manifest_number || `MDF-${loadNumber}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
      const uf_route = form.uf_route.split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const { data, error } = await supabase.from('load_manifests').insert({
        tenant_id: currentTenant.id,
        load_id: loadId,
        manifest_number,
        responsible_name: form.responsible_name || null,
        responsible_cnpj: form.responsible_cnpj || null,
        responsible_ie: form.responsible_ie || null,
        responsible_address: form.responsible_address || null,
        responsible_neighborhood: form.responsible_neighborhood || null,
        responsible_city: form.responsible_city || null,
        receipt_number: form.receipt_number || null,
        toll_value: form.toll_value ? Number(form.toll_value) : null,
        origin: form.origin || null,
        destination: form.destination || null,
        uf_route,
        observations: form.observations || null,
        fiscal_document_ids: nfeIds,
        cte_document_ids: ctes.filter((c: any) => !c.is_voided).map((c: any) => c.id),
        status: 'issued',
        created_by: user?.id ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Manifesto gerado com sucesso');
      qc.invalidateQueries({ queryKey: ['load_manifest', loadId] });
      setForm(f => ({ ...f, manifest_number: '' }));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const downloadPDF = (manifest?: any) => {
    const m = manifest || existing;
    const number = m?.manifest_number || form.manifest_number || `MDF-${loadNumber}`;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 40;

    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text('MANIFESTO DE CARGA / MDF-e', pageW / 2, y, { align: 'center' });
    y += 18;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Nº ${number}`, pageW / 2, y, { align: 'center' });
    y += 8;
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Emitido em ${new Date(m?.created_at || Date.now()).toLocaleString('pt-BR')} · Carga ${loadNumber}`, pageW / 2, y, { align: 'center' });
    doc.setTextColor(0);
    y += 16;

    const info: Array<[string, string]> = [
      ['Responsável', m?.responsible_name || form.responsible_name || '—'],
      ['CNPJ', m?.responsible_cnpj || form.responsible_cnpj || '—'],
      ['IE', m?.responsible_ie || form.responsible_ie || '—'],
      ['Endereço', m?.responsible_address || form.responsible_address || '—'],
      ['Bairro', m?.responsible_neighborhood || form.responsible_neighborhood || '—'],
      ['Município', m?.responsible_city || form.responsible_city || '—'],
      ['Origem', m?.origin || form.origin || '—'],
      ['Destino', m?.destination || form.destination || '—'],
      ['UFs do Percurso', Array.isArray(m?.uf_route) ? m.uf_route.join(', ') : form.uf_route || '—'],
      ['Nº Comprovante', m?.receipt_number || form.receipt_number || '—'],
      ['Valor Pedágio', m?.toll_value != null ? fmt(Number(m.toll_value)) : (form.toll_value ? fmt(Number(form.toll_value)) : '—')],
    ];
    autoTable(doc, {
      startY: y,
      body: info,
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
      margin: { left: 30, right: 30 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    autoTable(doc, {
      startY: y,
      head: [['NF', 'Chave', 'Destinatário', 'Cidade/UF', 'Valor', 'Peso (kg)']],
      body: (nfes as any[]).map(d => [
        d.invoice_number || '—',
        d.access_key || '—',
        d.recipient || '—',
        `${d.recipient_city || ''}${d.recipient_state ? '-' + d.recipient_state : ''}`,
        d.value ? fmt(Number(d.value)) : '—',
        String(d.weight_kg || 0),
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      margin: { left: 30, right: 30 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    autoTable(doc, {
      startY: y,
      head: [['CT-e', 'Série', 'Chave', 'Destinatário', 'Frete']],
      body: (ctes as any[]).filter(c => !c.is_voided).map(c => [
        c.cte_number || '—',
        c.cte_series || '—',
        c.access_key || '—',
        `${c.recipient || ''}${c.recipient_city ? ' / ' + c.recipient_city : ''}${c.recipient_state ? '-' + c.recipient_state : ''}`,
        c.freight_value ? fmt(Number(c.freight_value)) : '—',
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      margin: { left: 30, right: 30 },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('Totais', 30, y); y += 4;
    autoTable(doc, {
      startY: y,
      body: [
        ['NF-es', String(totals.nfeCount), 'CT-es', String(totals.cteCount)],
        ['Paletes', String(totals.pallets), 'Peso Total', `${totals.weight.toLocaleString('pt-BR')} kg`],
        ['Valor Mercadoria', fmt(totals.value), 'Frete CT-es', fmt(totals.freight)],
      ],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
      margin: { left: 30, right: 30 },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    const obs = m?.observations || form.observations;
    if (obs) {
      doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text('Observações', 30, y); y += 10;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(obs), pageW - 60);
      doc.text(lines, 30, y);
      y += lines.length * 10 + 10;
    }

    if (y > 700) { doc.addPage(); y = 60; }
    doc.setFontSize(8);
    doc.text('_______________________________________', 30, y + 30);
    doc.text('Assinatura do Responsável', 30, y + 42);
    doc.text('_______________________________________', pageW - 230, y + 30);
    doc.text('Assinatura do Motorista', pageW - 230, y + 42);

    doc.save(`manifesto-${number}.pdf`);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileSignature className="h-4 w-4" /> Manifesto / MDF-e (SEFAZ)
          {existing && <Badge variant="outline" className="text-[10px]">Nº {existing.manifest_number}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ortCount > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-info/10 border border-info/30 text-xs">
            <Info className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
            <span>
              <strong>{ortCount}</strong> NF(s) marcadas como ORT (organização interna) foram excluídas do manifesto — não possuem valor fiscal e não vão ao SEFAZ.
            </span>
          </div>
        )}

        {totals.nfeCount === 0 ? (
          <div className="flex items-center gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Nenhuma NF-e com CT-e vinculada. Gere CT-es antes de emitir o manifesto.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 rounded-md bg-muted/40 border text-xs">
              <div><span className="text-muted-foreground">NF-es</span><div className="font-semibold text-base">{totals.nfeCount}</div></div>
              <div><span className="text-muted-foreground">CT-es</span><div className="font-semibold text-base">{totals.cteCount}</div></div>
              <div><span className="text-muted-foreground">Paletes</span><div className="font-semibold text-base">{totals.pallets}</div></div>
              <div><span className="text-muted-foreground">Peso</span><div className="font-semibold text-base">{totals.weight.toLocaleString('pt-BR')} kg</div></div>
              <div><span className="text-muted-foreground">Frete CT-es</span><div className="font-semibold text-base">{fmt(totals.freight)}</div></div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">NF-es vinculadas via CT-e</p>
              <div className="border rounded-md max-h-56 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">NF</TableHead>
                      <TableHead className="text-xs">Chave</TableHead>
                      <TableHead className="text-xs">Destinatário</TableHead>
                      <TableHead className="text-xs text-right">Valor</TableHead>
                      <TableHead className="text-xs text-right">Peso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(nfes as any[]).map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs font-medium">{d.invoice_number || '—'}</TableCell>
                        <TableCell className="text-[10px] font-mono text-muted-foreground">{d.access_key ? d.access_key.slice(-12) : '—'}</TableCell>
                        <TableCell className="text-xs">{d.recipient || '—'}{d.recipient_city ? ` / ${d.recipient_city}` : ''}{d.recipient_state ? `-${d.recipient_state}` : ''}</TableCell>
                        <TableCell className="text-xs text-right">{d.value ? fmt(Number(d.value)) : '—'}</TableCell>
                        <TableCell className="text-xs text-right">{d.weight_kg || 0} kg</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Nº Manifesto</Label>
                  <Input value={form.manifest_number} onChange={e => setForm({ ...form, manifest_number: e.target.value })} placeholder="auto se vazio" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Responsável (Nome)</Label>
                  <Input value={form.responsible_name} onChange={e => setForm({ ...form, responsible_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs">CNPJ</Label><Input value={form.responsible_cnpj} onChange={e => setForm({ ...form, responsible_cnpj: e.target.value })} /></div>
                <div><Label className="text-xs">IE</Label><Input value={form.responsible_ie} onChange={e => setForm({ ...form, responsible_ie: e.target.value })} /></div>
                <div><Label className="text-xs">Bairro</Label><Input value={form.responsible_neighborhood} onChange={e => setForm({ ...form, responsible_neighborhood: e.target.value })} /></div>
                <div><Label className="text-xs">Município</Label><Input value={form.responsible_city} onChange={e => setForm({ ...form, responsible_city: e.target.value })} /></div>
              </div>
              <div>
                <Label className="text-xs">Endereço</Label>
                <Input value={form.responsible_address} onChange={e => setForm({ ...form, responsible_address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs">Nº Comprovante</Label><Input value={form.receipt_number} onChange={e => setForm({ ...form, receipt_number: e.target.value })} /></div>
                <div><Label className="text-xs">Valor Pedágio</Label><Input type="number" step="0.01" value={form.toll_value} onChange={e => setForm({ ...form, toll_value: e.target.value })} /></div>
                <div><Label className="text-xs">Origem</Label><Input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} /></div>
                <div><Label className="text-xs">Destino</Label><Input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} /></div>
              </div>
              <div>
                <Label className="text-xs">UFs do Percurso (ex: MG, SP, RJ)</Label>
                <Input value={form.uf_route} onChange={e => setForm({ ...form, uf_route: e.target.value })} placeholder={UF_LIST.join(', ')} />
              </div>
              <div>
                <Label className="text-xs">Observações</Label>
                <Textarea rows={3} value={form.observations} onChange={e => setForm({ ...form, observations: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                {(existing || totals.nfeCount > 0) && (
                  <Button variant="outline" onClick={() => downloadPDF()}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                  </Button>
                )}
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  {generateMutation.isPending ? 'Gerando...' : 'Gerar Manifesto'}
                </Button>
              </div>
            </div>

            {existing && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-success/10 border border-success/30 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                Último manifesto: <strong>{existing.manifest_number}</strong> · {new Date(existing.created_at).toLocaleString('pt-BR')}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}