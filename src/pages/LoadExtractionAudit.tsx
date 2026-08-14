import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { AlertTriangle, Eye, FileSearch, Search, X, Copy, Check } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

interface AuditDoc {
  id: string;
  invoice_number: string | null;
  access_key: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  issue_date: string | null;
  client_id: string | null;
  client_load_number: string | null;
  client_load_source: any;
  load_id: string | null;
}

interface ClientLite {
  id: string;
  company_name: string;
}

const SENTINEL_ALL = '__all__';

export default function LoadExtractionAudit() {
  const { currentTenant } = useTenant();
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>(SENTINEL_ALL);
  const [openDoc, setOpenDoc] = useState<AuditDoc | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['audit-clients', currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async (): Promise<ClientLite[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('tenant_id', currentTenant!.id)
        .order('company_name');
      if (error) throw error;
      return (data as ClientLite[]) || [];
    },
  });

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['audit-missing-load', currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async (): Promise<AuditDoc[]> => {
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, remitter, recipient, recipient_city, recipient_state, issue_date, client_id, client_load_number, client_load_source, load_id')
        .eq('tenant_id', currentTenant!.id)
        .is('client_load_number', null)
        .order('issue_date', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data as AuditDoc[]) || [];
    },
  });

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.company_name);
    return m;
  }, [clients]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return docs.filter(d => {
      if (clientFilter !== SENTINEL_ALL && d.client_id !== clientFilter) return false;
      if (!term) return true;
      const haystack = [
        d.access_key, d.invoice_number, d.recipient, d.remitter, d.recipient_city,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [docs, search, clientFilter]);

  const observationOf = (doc: AuditDoc | null): string => {
    if (!doc) return '';
    const src = doc.client_load_source as any;
    if (src && typeof src === 'object') {
      return src.observationSnippet || src.observation || src.snippet || '';
    }
    return '';
  };

  const sourceLabel = (doc: AuditDoc): string => {
    const src = doc.client_load_source as any;
    if (src?.observationSnippet) return 'observação capturada';
    if (src?.source === 'none') return 'sem padrão reconhecido';
    return 'sem dados de origem';
  };

  const handleCopy = async () => {
    const text = observationOf(openDoc);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Trecho copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const header = ['NF', 'Chave de Acesso', 'Cliente', 'Destinatário', 'Cidade/UF', 'Emissão', 'Origem', 'Observação'];
    const rows = filtered.map(d => [
      d.invoice_number || '',
      d.access_key || '',
      d.client_id ? (clientNameById.get(d.client_id) || '') : '',
      d.recipient || '',
      `${d.recipient_city || ''}${d.recipient_state ? '/' + d.recipient_state : ''}`,
      d.issue_date || '',
      sourceLabel(d),
      observationOf(d).replace(/\s+/g, ' ').slice(0, 600),
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-cargas-nao-extraidas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileSearch className="h-6 w-6 text-primary" />
              Auditoria de Extração de Carga
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              NFs onde o número da carga do cliente não foi identificado durante a importação.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              Exportar CSV
            </Button>
            <Link to="/traceability">
              <Button variant="outline" size="sm">Ir para Rastreabilidade</Button>
            </Link>
          </div>
        </div>

        <Card className={docs.length > 0 ? 'border-warning/30 bg-warning/5' : ''}>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/15">
              <AlertTriangle className="h-4 w-4 text-warning" />
            </div>
            <div className="text-sm">
              <span className="font-semibold">{docs.length}</span> NFs sem número de carga extraído
              {docs.length === 1000 && (
                <span className="text-muted-foreground"> (limite de 1.000 — refine com filtros)</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Buscar por chave de acesso, NF, destinatário</Label>
              <div className="relative mt-1">
                <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="44 dígitos ou texto livre"
                  className="pl-7 h-8 text-xs"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SENTINEL_ALL}>Todos os clientes</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="text-xs text-muted-foreground">
                Exibindo <span className="font-semibold text-foreground">{filtered.length}</span> de {docs.length} NFs
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">NF</TableHead>
                  <TableHead className="text-xs">Chave de Acesso</TableHead>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs">Destino</TableHead>
                  <TableHead className="text-xs">Emissão</TableHead>
                  <TableHead className="text-xs">Origem do diagnóstico</TableHead>
                  <TableHead className="text-xs text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">Nenhuma NF encontrada com os filtros atuais.</TableCell></TableRow>
                ) : filtered.map(d => {
                  const hasObs = !!observationOf(d);
                  return (
                    <TableRow key={d.id} className="text-xs">
                      <TableCell className="font-medium">{d.invoice_number || '—'}</TableCell>
                      <TableCell className="font-mono text-[10px]">{d.access_key || '—'}</TableCell>
                      <TableCell>{d.client_id ? (clientNameById.get(d.client_id) || '—') : <span className="text-muted-foreground">não vinculado</span>}</TableCell>
                      <TableCell>{d.recipient_city || '—'}{d.recipient_state ? `/${d.recipient_state}` : ''}</TableCell>
                      <TableCell>{d.issue_date || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={hasObs ? 'bg-warning/10 text-warning border-warning/30' : 'bg-muted text-muted-foreground'}>
                          {sourceLabel(d)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={!hasObs}
                          onClick={() => setOpenDoc(d)}
                        >
                          <Eye className="h-3 w-3 mr-1" /> Ver observação
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!openDoc} onOpenChange={(o) => !o && setOpenDoc(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                NF {openDoc?.invoice_number || '—'} — Trecho da observação
              </DialogTitle>
              <DialogDescription>
                Texto capturado do XML quando nenhuma regra de extração identificou o número da carga.
                Use este trecho para ajustar as regras em <code className="text-xs">CLIENT_LOAD_OBSERVATION_RULES</code>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Chave: </span><span className="font-mono">{openDoc?.access_key || '—'}</span></div>
                <div><span className="text-muted-foreground">Cliente: </span>{openDoc?.client_id ? (clientNameById.get(openDoc.client_id) || '—') : '—'}</div>
                <div><span className="text-muted-foreground">Destinatário: </span>{openDoc?.recipient || '—'}</div>
                <div><span className="text-muted-foreground">Emissão: </span>{openDoc?.issue_date || '—'}</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Observação capturada</Label>
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={handleCopy} disabled={!observationOf(openDoc)}>
                    {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <pre className="bg-muted/40 border rounded p-3 text-xs whitespace-pre-wrap break-words max-h-72 overflow-auto">
                  {observationOf(openDoc) || 'Nenhum trecho de observação foi armazenado para esta NF.'}
                </pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}