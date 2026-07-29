import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Send, Ban, Edit, FileText, FilePlus2 } from 'lucide-react';
import { useNFSeList, useIssueNFSe, useCancelNFSe, type NFSeDoc } from '@/hooks/useNFSe';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';

const STATUS_LABEL: Record<string, { label: string; variant: any }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  queued: { label: 'Em fila', variant: 'outline' },
  processing: { label: 'Processando', variant: 'outline' },
  issued: { label: 'Emitida', variant: 'default' },
  authorized: { label: 'Emitida', variant: 'default' },
  rejected: { label: 'Rejeitada', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  error: { label: 'Erro', variant: 'destructive' },
};

export default function NFSePage() {
  const { data: docs = [], isLoading } = useNFSeList();
  const issue = useIssueNFSe();
  const cancel = useCancelNFSe();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [fromInvoicesOpen, setFromInvoicesOpen] = useState(false);
  const [editing, setEditing] = useState<NFSeDoc | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return docs;
    return docs.filter(d =>
      [d.rps_number, d.nfse_number, d.cliente_nome, d.cliente_cnpj, d.reference_number]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(s))
    );
  }, [docs, search]);

  const handleCancel = async (id: string) => {
    const reason = window.prompt('Motivo do cancelamento:');
    if (!reason) return;
    await cancel.mutateAsync({ id, reason });
  };

  return (
    <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">NFS-e — Notas Fiscais de Serviço</h1>
            <p className="text-sm text-muted-foreground">Emissão de RPS / NFS-e (estrutura preparada para integração fiscal)</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> RPS avulso
            </Button>
            <Button onClick={() => setFromInvoicesOpen(true)}>
              <FilePlus2 className="h-4 w-4 mr-1" /> Emitir a partir de NFs
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Consulta — NFS-e</CardTitle>
            <Input className="max-w-xs" placeholder="Buscar nº, cliente, CNPJ…" value={search} onChange={e => setSearch(e.target.value)} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RPS / Nº NFS-e</TableHead>
                  <TableHead>Série</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Vl. Serviços</TableHead>
                  <TableHead className="text-right">ISS</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma NFS-e</TableCell></TableRow>
                )}
                {filtered.map(d => {
                  const st = STATUS_LABEL[d.status] || { label: d.status, variant: 'secondary' };
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.nfse_number || `RPS ${d.rps_number}`}</TableCell>
                      <TableCell>{d.series}</TableCell>
                      <TableCell>{d.issue_date}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{d.cliente_nome || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {Number(d.valor_servicos).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {Number(d.valor_iss).toFixed(2)}</TableCell>
                      <TableCell><Badge variant={st.variant as any}>{st.label}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {d.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(d); setFormOpen(true); }}>
                            <Edit className="h-3 w-3" />
                          </Button>
                        )}
                        {(d.status === 'draft' || d.status === 'rejected') && (
                          <Button size="sm" variant="outline" onClick={() => issue.mutate(d.id)} disabled={issue.isPending}>
                            <Send className="h-3 w-3 mr-1" /> Emitir
                          </Button>
                        )}
                        {d.status === 'issued' && (
                          <Button size="sm" variant="ghost" onClick={() => handleCancel(d.id)}>
                            <Ban className="h-3 w-3 mr-1" /> Cancelar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <NFSeFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />
        <NFSeFromInvoicesDialog open={fromInvoicesOpen} onOpenChange={setFromInvoicesOpen} />
    </div>
  );
}
