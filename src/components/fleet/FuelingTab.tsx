import { useState, useMemo } from 'react';
import { useCreateFueling, useConsumptionHistory } from '@/hooks/useFleetManagement';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Fuel, TrendingUp, DollarSign, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const FUEL_TYPES = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'diesel_s10', label: 'Diesel S10' },
  { value: 'gasoline', label: 'Gasolina' },
  { value: 'ethanol', label: 'Etanol' },
  { value: 'gas', label: 'GNV' },
];

interface Props {
  vehicleId: string;
}

export default function FuelingTab({ vehicleId }: Props) {
  const { consumption, avgKmPerLiter, fuelings } = useConsumptionHistory(vehicleId);
  const createMut = useCreateFueling();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    fueled_at: new Date().toISOString().slice(0, 16),
    liters: '',
    price_per_liter: '',
    fuel_type: 'diesel',
    odometer_km: '',
    station_name: '',
    is_full_tank: true,
    notes: '',
  });

  const totalLiters = fuelings.reduce((s, f) => s + Number(f.liters), 0);
  const totalCost = fuelings.reduce((s, f) => s + (Number(f.total_cost) || 0), 0);

  const chartData = useMemo(() => consumption.map(c => ({
    date: format(new Date(c.date), 'dd/MM'),
    kmPerLiter: Number(c.kmPerLiter.toFixed(2)),
  })), [consumption]);

  const handleSave = async () => {
    try {
      await createMut.mutateAsync({
        vehicle_id: vehicleId,
        fueled_at: new Date(form.fueled_at).toISOString(),
        liters: Number(form.liters),
        price_per_liter: form.price_per_liter ? Number(form.price_per_liter) : null,
        fuel_type: form.fuel_type,
        odometer_km: form.odometer_km ? Number(form.odometer_km) : null,
        station_name: form.station_name || null,
        is_full_tank: form.is_full_tank,
        notes: form.notes || null,
      } as any);
      toast.success('Abastecimento registrado');
      setDialogOpen(false);
      setForm({ fueled_at: new Date().toISOString().slice(0, 16), liters: '', price_per_liter: '', fuel_type: 'diesel', odometer_km: '', station_name: '', is_full_tank: true, notes: '' });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Fuel className="h-5 w-5 text-primary shrink-0" />
            <div><p className="text-xs text-muted-foreground">Total Litros</p><p className="text-lg font-semibold">{totalLiters.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-primary shrink-0" />
            <div><p className="text-xs text-muted-foreground">Total Gasto</p><p className="text-lg font-semibold">R$ {totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Média km/L</p><p className="text-lg font-semibold">{avgKmPerLiter ? avgKmPerLiter.toFixed(2) : '—'}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Gauge className="h-5 w-5 text-muted-foreground shrink-0" />
            <div><p className="text-xs text-muted-foreground">Abastecimentos</p><p className="text-lg font-semibold">{fuelings.length}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Consumption chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Consumo km/L ao longo do tempo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="kmPerLiter" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="km/L" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-foreground">Registro de Abastecimentos</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo Abastecimento
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Litros</TableHead>
                <TableHead className="text-right">R$/L</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Combustível</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead>Posto</TableHead>
                <TableHead>Tanque Cheio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fuelings.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum abastecimento registrado</TableCell></TableRow>
              ) : fuelings.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="text-sm">{format(new Date(f.fueled_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{Number(f.liters).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-sm text-right">{f.price_per_liter ? `R$ ${Number(f.price_per_liter).toFixed(3)}` : '—'}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{f.total_cost ? `R$ ${Number(f.total_cost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{FUEL_TYPES.find(t => t.value === f.fuel_type)?.label || f.fuel_type}</Badge></TableCell>
                  <TableCell className="text-sm text-right font-mono">{f.odometer_km ? Number(f.odometer_km).toLocaleString('pt-BR') : '—'}</TableCell>
                  <TableCell className="text-sm">{f.station_name || '—'}</TableCell>
                  <TableCell>{f.is_full_tank ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 text-xs">Sim</Badge> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add fueling dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo Abastecimento</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Data/Hora</Label><Input type="datetime-local" value={form.fueled_at} onChange={e => setForm(f => ({ ...f, fueled_at: e.target.value }))} /></div>
              <div>
                <Label>Combustível</Label>
                <Select value={form.fuel_type} onValueChange={v => setForm(f => ({ ...f, fuel_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FUEL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Litros *</Label><Input type="number" step="0.01" value={form.liters} onChange={e => setForm(f => ({ ...f, liters: e.target.value }))} required /></div>
              <div><Label>Preço/Litro</Label><Input type="number" step="0.001" value={form.price_per_liter} onChange={e => setForm(f => ({ ...f, price_per_liter: e.target.value }))} /></div>
              <div>
                <Label>Total (R$)</Label>
                <Input readOnly value={form.liters && form.price_per_liter ? (Number(form.liters) * Number(form.price_per_liter)).toFixed(2) : ''} className="bg-muted/50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Km Odômetro</Label><Input type="number" value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} placeholder="Leitura atual" /></div>
              <div><Label>Posto</Label><Input value={form.station_name} onChange={e => setForm(f => ({ ...f, station_name: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.is_full_tank} onCheckedChange={v => setForm(f => ({ ...f, is_full_tank: !!v }))} id="full_tank" />
              <label htmlFor="full_tank" className="text-sm">Tanque cheio (necessário para cálculo de km/L)</label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!form.liters || createMut.isPending}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
