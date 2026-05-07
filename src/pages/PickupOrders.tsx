import { useState, useMemo } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Pencil, Trash2, PackageOpen, FileText } from 'lucide-react';
import { usePickupOrders, useDeletePickupOrder, usePickupOrderCounts, PICKUP_STATUSES, PICKUP_STATUS_LABELS, PickupOrder } from '@/hooks/usePickupOrders';
import NewPickupOrderDialog from '@/components/pickup/NewPickupOrderDialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

const STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  vinculada: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  finalizada: 'bg-green-500/15 text-green-700 dark:text-green-400',
  cancelada: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export default function PickupOrders() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PickupOrder | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: pickups = [], isLoading } = usePickupOrders({
    status: statusFilter as any,
    search: search.length >= 2 ? search : undefined,
  });
  const ids = useMemo(() => pickups.map(p => p.id), [pickups]);
  const { data: counts = {} } = usePickupOrderCounts(ids);
  const deleteMut = useDeletePickupOrder();

  const totals = useMemo(() => ({
    total: pickups.length,
    pendentes: pickups.filter(p => p.status === 'pendente').length,
    vinculadas: pickups.filter(p => p.status === 'vinculada').length,
    finalizadas: pickups.filter(p => p.status === 'finalizada').length,
    xmls: Object.values(counts).reduce((a, b) => a + b, 0),
  }), [pickups, counts]);

  const handleEdit = (p: PickupOrder) => { setEditing(p); setDialogOpen(true); };
  const handleNew = () => { setEditing(null); setDialogOpen(true); };
  const handleDelete = async (p: PickupOrder) => {
    if (!confirm(`Excluir Coleta nº ${p.pickup_number}?`)) return;
    try {
      await deleteMut.mutateAsync(p.id);
      toast({ title: 'Coleta excluída' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <PackageOpen className="h-6 w-6 text-primary" /> Coletas
            </h1>
            <p className="text-sm text-muted-foreground">
              Registre operações de busca de mercadorias e vincule lotes de XML.
            </p>
          </div>
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 mr-2" /> Nova Coleta
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: totals.total },
            { label: 'Pendentes', value: totals.pendentes },
            { label: 'Vinculadas', value: totals.vinculadas },
            { label: 'Finalizadas', value: totals.finalizadas },
            { label: 'XMLs vinculados', value: totals.xmls },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-2xl font-semibold">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nº, motorista, fornecedor ou placa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {PICKUP_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{PICKUP_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead>XMLs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : pickups.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma coleta encontrada.</TableCell></TableRow>
                ) : pickups.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">#{p.pickup_number}</TableCell>
                    <TableCell>{p.pickup_at && format(new Date(p.pickup_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{p.remitter_name || '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{p.recipient_name || '—'}</TableCell>
                    <TableCell>{p.driver_name_snapshot || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{p.vehicle_plate_snapshot || '—'}</TableCell>
                    <TableCell>
                      {(counts[p.id] ?? 0) > 0 ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 gap-1"
                          onClick={() => navigate(`/fiscal-documents?pickup=${p.id}`)}
                        >
                          <FileText className="h-3 w-3" /> {counts[p.id]} XML(s)
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[p.status] || ''} variant="outline">
                        {PICKUP_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <NewPickupOrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pickup={editing}
      />
    </AppLayout>
  );
}