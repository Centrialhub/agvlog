import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Search, Filter, ChevronDown, CheckCircle2, AlertTriangle, Clock, FileSearch } from 'lucide-react';
import { format } from 'date-fns';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import { usePagination } from '@/hooks/usePagination';
import { DataPagination } from '@/components/ui/data-pagination';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSonnerToast } from '@/hooks/useSonnerToast';

interface OrtAudit {
  id: string;
  ort_number: string | null;
  source_file_name: string;
  status: string;
  overall_confidence: number;
  needs_review: boolean;
  reviewed: boolean;
  created_at: string;
  reviewed_at: string | null;
  fiscal_document_id: string | null;
  extracted_payload: any;
  reviewed_payload: any;
  changed_fields: string[];
  updated_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  reviewed: 'Revisado',
  applied: 'Aplicado',
  rejected: 'Rejeitado',
};

function statusColor(s: string) {
  if (s === 'applied' || s === 'reviewed') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (s === 'rejected') return 'bg-destructive/10 text-destructive border-destructive/20';
  return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
}

export default function OrtConsultaTab() {
  const { currentTenant } = useTenant();
  const toast = useSonnerToast();
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [ortNumber, setOrtNumber] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [reviewFilter, setReviewFilter] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fileQ, setFileQ] = useState('');
  const [detail, setDetail] = useState<OrtAudit | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const { data = [], isLoading, isFetching, isError, error: queryError, refetch } = useQuery({
    queryKey: ['ort_audits', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      return await fetchAllPostgrestPages((pageFrom, pageTo) => supabase
        .from('ort_extraction_audits' as any)
        .select('id, ort_number, source_file_name, status, overall_confidence, needs_review, reviewed, created_at, reviewed_at, fiscal_document_id, extracted_payload, reviewed_payload, changed_fields, updated_at')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(pageFrom, pageTo)) as unknown as OrtAudit[];
    },
    retry: false,
  });

  const filtered = useMemo(() => {
    return data.filter(d => {
      if (ortNumber && !(d.ort_number || '').toLowerCase().includes(ortNumber.toLowerCase())) return false;
      if (status !== 'all' && d.status !== status) return false;
      if (reviewFilter === 'needs' && !d.needs_review) return false;
      if (reviewFilter === 'reviewed' && !d.reviewed) return false;
      if (reviewFilter === 'pending' && d.reviewed) return false;
      if (fileQ && !(d.source_file_name || '').toLowerCase().includes(fileQ.toLowerCase())) return false;
      if (from && d.created_at < from) return false;
      if (to && d.created_at > to + 'T23:59:59') return false;
      return true;
    });
  }, [data, ortNumber, status, reviewFilter, fileQ, from, to]);

  const totals = useMemo(() => ({
    total: filtered.length,
    review: filtered.filter(d => d.needs_review).length,
    applied: filtered.filter(d => d.status === 'applied').length,
    avgConf: filtered.length
      ? Math.round((filtered.reduce((s, d) => s + (d.overall_confidence || 0), 0) / filtered.length) * 100)
      : 0,
  }), [filtered]);
  const pagination = usePagination(filtered, {
    pageSize: 50,
    resetKey: `${ortNumber}|${status}|${reviewFilter}|${fileQ}|${from}|${to}`,
  });

  const review = async (decision: 'approve' | 'reject') => {
    if (!currentTenant || !detail) return;
    setReviewing(true);
    try {
      const { error } = await supabase.rpc('review_ort_extraction_v1' as never, {
        _tenant_id: currentTenant.id,
        _audit_id: detail.id,
        _decision: decision,
        _reviewed_payload: detail.reviewed_payload || detail.extracted_payload || {},
        _expected_updated_at: detail.updated_at,
      } as never);
      if (error) throw error;
      toast.success(decision === 'approve' ? 'Revisão aprovada e concluída.' : 'Extração rejeitada.');
      setDetail(null);
      await refetch();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a revisão.');
    } finally {
      setReviewing(false);
    }
  };

  function clearAll() {
    setOrtNumber(''); setStatus('all'); setReviewFilter('all'); setFrom(''); setTo(''); setFileQ('');
  }

  return (
    <div className="space-y-4">
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="h-4 w-4 text-primary" /> Filtros — Consulta ORT
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 border-t pt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Nº ORT</Label>
                  <Input value={ortNumber} onChange={e => setOrtNumber(e.target.value)} placeholder="Ex: 12345" />
                </div>
                <div>
                  <Label className="text-xs">Arquivo de origem</Label>
                  <Input value={fileQ} onChange={e => setFileQ(e.target.value)} placeholder="nome.pdf / .xml" />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="reviewed">Revisado</SelectItem>
                      <SelectItem value="applied">Aplicado</SelectItem>
                      <SelectItem value="rejected">Rejeitado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Revisão</Label>
                  <Select value={reviewFilter} onValueChange={setReviewFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="needs">Requer revisão</SelectItem>
                      <SelectItem value="reviewed">Já revisada</SelectItem>
                      <SelectItem value="pending">Aguardando revisão</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Data inicial</Label>
                  <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Data final</Label>
                  <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={clearAll}>Limpar</Button>
                <Button size="sm" onClick={() => refetch()} disabled={isFetching}><Search className="h-4 w-4 mr-1" /> Buscar</Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'ORTs exibidas', value: totals.total, icon: FileSearch, color: 'text-primary' },
          { label: 'Aguardam revisão', value: totals.review, icon: AlertTriangle, color: 'text-amber-500' },
          { label: 'Aplicadas', value: totals.applied, icon: CheckCircle2, color: 'text-emerald-500' },
          { label: 'Confiança média', value: `${totals.avgConf}%`, icon: Clock, color: 'text-muted-foreground' },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <c.icon className={`h-5 w-5 ${c.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-lg font-semibold">{isError ? '—' : c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº ORT</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Confiança</TableHead>
                <TableHead>Revisão</TableHead>
                <TableHead>NF vinculada</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-destructive">Não foi possível consultar as ORTs. {queryError instanceof Error ? queryError.message : ''} <Button variant="link" onClick={() => refetch()}>Tentar novamente</Button></TableCell></TableRow>
              ) : isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Nenhuma ORT encontrada.</TableCell></TableRow>
              ) : pagination.items.map(o => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => setDetail(o)}>
                  <TableCell className="font-mono">{o.ort_number || '—'}</TableCell>
                  <TableCell className="text-sm max-w-[280px] truncate" title={o.source_file_name}>{o.source_file_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(o.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColor(o.status)}>{STATUS_LABEL[o.status] || o.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{Math.round((o.overall_confidence || 0) * 100)}%</TableCell>
                  <TableCell>
                    {o.needs_review ? (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Requer revisão</Badge>
                    ) : o.reviewed ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Revisada</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.fiscal_document_id ? <span className="font-mono">{o.fiscal_document_id.slice(0, 8)}…</span> : '—'}
                  </TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setDetail(o); }}>Detalhes</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isError && <DataPagination {...pagination} onPageChange={pagination.setPage} />}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisão da ORT {detail?.ort_number || 'sem número'}</DialogTitle>
            <DialogDescription>Compare a extração original com os dados revisados antes de concluir.</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="space-y-2"><h3 className="text-sm font-medium">Extração original</h3><pre className="max-h-80 overflow-auto rounded border bg-muted p-3 text-xs whitespace-pre-wrap">{JSON.stringify(detail.extracted_payload, null, 2)}</pre></section>
              <section className="space-y-2"><h3 className="text-sm font-medium">Dados revisados</h3><pre className="max-h-80 overflow-auto rounded border bg-muted p-3 text-xs whitespace-pre-wrap">{JSON.stringify(detail.reviewed_payload, null, 2)}</pre></section>
              <div className="md:col-span-2 text-xs text-muted-foreground">Campos alterados: {detail.changed_fields?.length ? detail.changed_fields.join(', ') : 'nenhum registrado'} · Última revisão: {detail.reviewed_at ? format(new Date(detail.reviewed_at), 'dd/MM/yyyy HH:mm') : 'não concluída'}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)} disabled={reviewing}>Fechar</Button>
            <Button variant="destructive" onClick={() => review('reject')} disabled={reviewing || detail?.status === 'rejected'}>Rejeitar</Button>
            <Button onClick={() => review('approve')} disabled={reviewing || detail?.status === 'applied' || detail?.status === 'reviewed'}>Aprovar e concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
