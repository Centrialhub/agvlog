import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sprout, Upload, Phone, Car, AlertTriangle, Download, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import {
  useRuralProfiles,
  useRuralClientsSummary,
  useRuralImportBatches,
  useCommitRuralImport,
  buildRuralImportPreview,
  type RuralImportPreview,
  type RuralClientsFilters,
} from '@/hooks/useRuralClients';
import { ruralProfilesToCsv, accessTypeLabel, deliveryModeLabel } from '@/lib/ruralClients/ruralDeliveryReports';
import { generateRuralClientsPdf } from '@/lib/ruralClients/ruralDeliveryPdf';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function RuralClients() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [filters, setFilters] = useState<RuralClientsFilters>({ active: true });
  const { data: profiles = [], isLoading } = useRuralProfiles(filters);
  const { data: summary } = useRuralClientsSummary();
  const { data: batches = [] } = useRuralImportBatches();
  const commitImport = useCommitRuralImport();

  const [preview, setPreview] = useState<RuralImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const pending = useMemo(() => profiles.filter(p =>
    (!p.driver_instructions || !p.driver_instructions.trim()) ||
    (p.taxi_required && !(p.taxi_contact_phone || '').trim()) ||
    (p.requires_contact_before_delivery && !(p.contact_phone || '').trim())
  ), [profiles]);

  const handleFile = async (f: File) => {
    if (!currentTenant) return;
    try {
      const buf = await f.arrayBuffer();
      const p = await buildRuralImportPreview(buf, f.name, currentTenant.id);
      setPreview(p);
      toast({ title: 'Prévia gerada', description: `${p.rows.length} linhas • ${p.toCreate} criar, ${p.toUpdate} atualizar, ${p.unmatched} sem cliente.` });
    } catch (e: any) {
      toast({ title: 'Erro ao ler planilha', description: e.message, variant: 'destructive' });
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await commitImport.mutateAsync(preview);
      toast({ title: 'Importação concluída', description: `${res.imported} criados, ${res.updated} atualizados, ${res.unmatched} sem cliente.` });
      setPreview(null);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sprout className="h-6 w-6 text-primary" /> Clientes Zona Rural
          </h1>
          <p className="text-sm text-muted-foreground">Cadastro e instruções de entrega para clientes rurais.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Clientes rurais" value={summary?.total ?? 0} />
        <KpiCard label="Com instrução" value={summary?.withInstructions ?? 0} />
        <KpiCard label="Sem instrução" value={summary?.withoutInstructions ?? 0} tone="warn" />
        <KpiCard label="Ligar antes" value={summary?.requireContact ?? 0} />
        <KpiCard label="Estrada de terra" value={summary?.dirtRoad ?? 0} />
        <KpiCard label="Sem telefone" value={summary?.withoutPhone ?? 0} tone="warn" />
      </div>

      <Tabs defaultValue="clients" className="w-full">
        <TabsList>
          <TabsTrigger value="clients">Clientes Rurais</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
          <TabsTrigger value="pending">Pendências ({pending.length})</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="space-y-4 pt-4">
          <Card><CardContent className="p-4 grid grid-cols-12 gap-3">
            <Input className="col-span-4" placeholder="Buscar cliente, cidade, bairro..."
              value={filters.search || ''} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
            <Input className="col-span-2" placeholder="Cidade" value={filters.city || ''}
              onChange={e => setFilters(f => ({ ...f, city: e.target.value }))} />
            <Select value={filters.accessType || 'all'}
              onValueChange={v => setFilters(f => ({ ...f, accessType: v === 'all' ? undefined : v }))}>
              <SelectTrigger className="col-span-2"><SelectValue placeholder="Acesso" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os acessos</SelectItem>
                <SelectItem value="paved">Asfalto</SelectItem>
                <SelectItem value="dirt_road">Estrada de terra</SelectItem>
                <SelectItem value="mixed">Misto</SelectItem>
                <SelectItem value="unknown">Desconhecido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.taxiRequired == null ? 'any' : filters.taxiRequired ? 'y' : 'n'}
              onValueChange={v => setFilters(f => ({ ...f, taxiRequired: v === 'any' ? undefined : v === 'y' }))}>
              <SelectTrigger className="col-span-2"><SelectValue placeholder="Táxi" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Táxi (todos)</SelectItem>
                <SelectItem value="y">Somente com táxi</SelectItem>
                <SelectItem value="n">Sem táxi</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.requiresContact == null ? 'any' : filters.requiresContact ? 'y' : 'n'}
              onValueChange={v => setFilters(f => ({ ...f, requiresContact: v === 'any' ? undefined : v === 'y' }))}>
              <SelectTrigger className="col-span-2"><SelectValue placeholder="Ligar antes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Contato (todos)</SelectItem>
                <SelectItem value="y">Precisa ligar antes</SelectItem>
                <SelectItem value="n">Não precisa</SelectItem>
              </SelectContent>
            </Select>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Bairro/Localidade</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Acesso</TableHead>
                <TableHead>KM</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Ligar</TableHead>
                <TableHead>Táxi</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Instrução Motorista</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
                ) : profiles.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Nenhum perfil rural encontrado</TableCell></TableRow>
                ) : profiles.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.client_name}</TableCell>
                    <TableCell>{p.city || '—'}</TableCell>
                    <TableCell>{p.neighborhood || p.locality || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.related_remitter_name || '—'}</TableCell>
                    <TableCell>{accessTypeLabel(p.access_type) || '—'}</TableCell>
                    <TableCell>{p.round_trip_km ?? '—'}</TableCell>
                    <TableCell>{deliveryModeLabel(p.delivery_mode)}</TableCell>
                    <TableCell>{p.requires_contact_before_delivery ? <Badge variant="secondary"><Phone className="h-3 w-3 mr-1"/>Sim</Badge> : '—'}</TableCell>
                    <TableCell>{p.taxi_required ? <Badge variant="secondary"><Car className="h-3 w-3 mr-1"/>Sim</Badge> : '—'}</TableCell>
                    <TableCell className="text-xs">{p.contact_phone || p.taxi_contact_phone || '—'}</TableCell>
                    <TableCell className="text-xs max-w-md truncate">{p.driver_instructions || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-4 pt-4">
          <Card><CardContent className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4"/> Importar planilha de zona rural</h3>
              <p className="text-xs text-muted-foreground mt-1">Suporta múltiplas abas por fornecedor. A importação atualiza cadastros e não cria documentos fiscais.</p>
            </div>
            <Input type="file" accept=".xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            {preview && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-4 text-sm">
                  <Badge>{preview.rows.length} linhas</Badge>
                  <Badge variant="secondary">Criar: {preview.toCreate}</Badge>
                  <Badge variant="secondary">Atualizar: {preview.toUpdate}</Badge>
                  <Badge variant="destructive">Sem cliente: {preview.unmatched}</Badge>
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" onClick={() => setPreview(null)}>Cancelar</Button>
                    <Button onClick={handleCommit} disabled={importing}>{importing ? 'Salvando...' : 'Confirmar importação'}</Button>
                  </div>
                </div>
                <div className="max-h-96 overflow-auto border rounded">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Ação</TableHead><TableHead>Aba</TableHead>
                      <TableHead>Destinatário</TableHead><TableHead>Cidade</TableHead>
                      <TableHead>Bairro</TableHead><TableHead>KM</TableHead>
                      <TableHead>Ligar</TableHead><TableHead>Táxi</TableHead>
                      <TableHead>Instrução</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {preview.rows.slice(0, 200).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Badge variant={r.action === 'unmatched' ? 'destructive' : r.action === 'update' ? 'secondary' : 'default'}>
                              {r.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.sheet}</TableCell>
                          <TableCell className="text-xs">{r.recipient_name_snapshot}</TableCell>
                          <TableCell className="text-xs">{r.city}</TableCell>
                          <TableCell className="text-xs">{r.neighborhood}</TableCell>
                          <TableCell className="text-xs">{r.round_trip_km ?? '—'}</TableCell>
                          <TableCell className="text-xs">{r.inferred.requires_contact_before_delivery ? 'sim' : ''}</TableCell>
                          <TableCell className="text-xs">{r.inferred.taxi_required ? 'sim' : ''}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">{r.resolution_text || r.taxi_text || ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent></Card>

          <Card><CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-2">Últimas importações</h4>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Arquivo</TableHead>
                <TableHead>Linhas</TableHead><TableHead>Criados</TableHead>
                <TableHead>Atualizados</TableHead><TableHead>Sem cliente</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">Nenhuma importação ainda.</TableCell></TableRow>
                ) : batches.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs">{new Date(b.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-xs">{b.file_name}</TableCell>
                    <TableCell>{b.row_count}</TableCell>
                    <TableCell>{b.imported_count}</TableCell>
                    <TableCell>{b.updated_count}</TableCell>
                    <TableCell>{b.unmatched_count}</TableCell>
                    <TableCell><Badge variant={b.status === 'completed' ? 'default' : 'secondary'}>{b.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4 pt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Cliente</TableHead><TableHead>Cidade</TableHead>
                <TableHead>Bairro</TableHead><TableHead>Tipo Pendência</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sem pendências.</TableCell></TableRow>
                ) : pending.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.client_name}</TableCell>
                    <TableCell>{p.city || '—'}</TableCell>
                    <TableCell>{p.neighborhood || '—'}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(!p.driver_instructions || !p.driver_instructions.trim()) && <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1"/>Sem instrução</Badge>}
                        {p.taxi_required && !p.taxi_contact_phone && <Badge variant="destructive">Táxi sem contato</Badge>}
                        {p.requires_contact_before_delivery && !p.contact_phone && <Badge variant="destructive">Sem telefone p/ ligar</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4 pt-4">
          <Card><CardContent className="p-6 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4"/> Relatório de Clientes Zona Rural</h3>
            <p className="text-xs text-muted-foreground">Exporta a lista filtrada atualmente na aba "Clientes Rurais".</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => download(new Blob([ruralProfilesToCsv(profiles)], { type: 'text/csv;charset=utf-8;' }), 'clientes-zona-rural.csv')}>
                <Download className="h-4 w-4 mr-2"/> CSV
              </Button>
              <Button onClick={() => download(generateRuralClientsPdf(profiles, { tenantName: currentTenant?.name, groupByCity: true }), 'clientes-zona-rural.pdf')}>
                <Download className="h-4 w-4 mr-2"/> PDF por cidade
              </Button>
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <Card><CardContent className="p-3">
      <div className={`text-2xl font-bold ${tone === 'warn' && value > 0 ? 'text-destructive' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}