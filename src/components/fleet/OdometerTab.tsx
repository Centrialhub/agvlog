import { useState } from 'react';
import { useVehicleOdometerList, useCreateOdometerReading } from '@/hooks/useFleetManagement';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Gauge, Plus, TrendingUp } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { format } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  telemetry: 'Telemetria',
  fueling: 'Abastecimento',
  maintenance: 'Manutenção',
};

interface Props {
  vehicleId: string;
}

export default function OdometerTab({ vehicleId }: Props) {
  const toast = useSonnerToast();
  const { data: readings = [], isLoading } = useVehicleOdometerList(vehicleId);
  const createMut = useCreateOdometerReading();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [km, setKm] = useState('');
  const [notes, setNotes] = useState('');

  const latest = readings[0];
  const oldest = readings[readings.length - 1];
  const totalKm = latest && oldest ? Number(latest.reading_km) - Number(oldest.reading_km) : null;

  const chartData = [...readings]
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
    .map(r => ({
      date: format(new Date(r.recorded_at), 'dd/MM'),
      km: Number(r.reading_km),
    }));

  const handleSave = async () => {
    try {
      await createMut.mutateAsync({ vehicle_id: vehicleId, reading_km: Number(km), notes: notes || undefined });
      toast.success('Leitura registrada');
      setDialogOpen(false);
      setKm('');
      setNotes('');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Gauge className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Odômetro Atual</p>
              <p className="text-lg font-semibold font-mono">{latest ? `${Number(latest.reading_km).toLocaleString('pt-BR')} km` : '—'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Km Registrados</p>
              <p className="text-lg font-semibold">{totalKm != null && totalKm > 0 ? `${totalKm.toLocaleString('pt-BR')} km` : '—'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Gauge className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Leituras</p>
              <p className="text-lg font-semibold">{readings.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Evolução do Odômetro</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v.toLocaleString('pt-BR')} km`} />
                <Area type="monotone" dataKey="km" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.1} strokeWidth={2} name="Km" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-foreground">Histórico de Leituras</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nova Leitura
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Observações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : readings.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma leitura registrada</TableCell></TableRow>
              ) : readings.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{format(new Date(r.recorded_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-medium">{Number(r.reading_km).toLocaleString('pt-BR')}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{SOURCE_LABELS[r.source] || r.source}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.notes || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Leitura de Odômetro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Quilometragem Atual (km)</Label>
              <Input type="number" value={km} onChange={e => setKm(e.target.value)} placeholder={latest ? `Última: ${Number(latest.reading_km).toLocaleString()}` : ''} required />
            </div>
            <div>
              <Label>Observações</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!km || createMut.isPending}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
