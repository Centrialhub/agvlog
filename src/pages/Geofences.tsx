import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Hexagon, Plus, Trash2, MapPin } from 'lucide-react';

export default function Geofences() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: geofences = [], isLoading } = useQuery({
    queryKey: ['geofences', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofences').select('id, tenant_id, name, category, enabled, created_at')
        .eq('tenant_id', currentTenant.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['geofence_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofence_events')
        .select('*, vehicles(plate), geofences(name)')
        .eq('tenant_id', currentTenant.id).order('event_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('geofences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); toast.success('Geofence removida'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Hexagon className="h-6 w-6 text-primary" /> Geofences
          </h1>
          <p className="text-sm text-muted-foreground">Defina cercas virtuais e monitore entradas/saídas</p>
        </div>
        {isAdmin && <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova Geofence</Button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Geofences list */}
        <Card>
          <CardHeader><CardTitle className="text-base">Geofences ({geofences.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : geofences.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    <Hexagon className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    Nenhuma geofence criada
                  </TableCell></TableRow>
                ) : geofences.map((g: any) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{g.category}</Badge></TableCell>
                    <TableCell><Badge variant={g.enabled ? 'default' : 'secondary'} className="text-xs">{g.enabled ? 'Ativa' : 'Inativa'}</Badge></TableCell>
                    <TableCell>{isAdmin && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover?')) deleteMutation.mutate(g.id); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent events */}
        <Card>
          <CardHeader><CardTitle className="text-base">Eventos Recentes</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Veículo</TableHead><TableHead>Geofence</TableHead><TableHead>Direção</TableHead><TableHead>Quando</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum evento registrado</TableCell></TableRow>
                ) : events.map((ev: any) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium">{ev.vehicles?.plate || '—'}</TableCell>
                    <TableCell>{ev.geofences?.name || '—'}</TableCell>
                    <TableCell><Badge variant={ev.direction === 'enter' ? 'default' : 'secondary'} className="text-xs">{ev.direction === 'enter' ? 'Entrada' : 'Saída'}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(ev.event_at).toLocaleString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {isAdmin && <NewGeofenceDialog open={dialogOpen} onOpenChange={setDialogOpen} tenantId={currentTenant?.id} />}
    </div>
  );
}

function NewGeofenceDialog({ open, onOpenChange, tenantId }: { open: boolean; onOpenChange: (v: boolean) => void; tenantId?: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('general');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const [loading, setLoading] = useState(false);

  // MVP: create circular geofence approximated as polygon
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);

    const cLat = parseFloat(lat);
    const cLng = parseFloat(lng);
    const r = parseFloat(radius);
    // Approximate circle as 32-point polygon
    const coords: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * 2 * Math.PI;
      const dLat = (r / 111320) * Math.cos(angle);
      const dLng = (r / (111320 * Math.cos(cLat * Math.PI / 180))) * Math.sin(angle);
      coords.push([cLng + dLng, cLat + dLat]);
    }

    const geojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [coords],
    });

    const { error } = await supabase.rpc('upsert_geofence', {
      _id: null as any,
      _tenant_id: tenantId,
      _name: name,
      _category: category,
      _geojson: geojson,
      _enabled: true,
    });

    if (error) toast.error(error.message);
    else { toast.success('Geofence criada!'); qc.invalidateQueries({ queryKey: ['geofences'] }); onOpenChange(false); }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova Geofence (circular)</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Geral</SelectItem>
                <SelectItem value="base">Base</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="restricted">Restrita</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Latitude</Label><Input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} required placeholder="-23.5505" /></div>
            <div className="space-y-2"><Label>Longitude</Label><Input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} required placeholder="-46.6333" /></div>
          </div>
          <div className="space-y-2"><Label>Raio (metros)</Label><Input type="number" value={radius} onChange={e => setRadius(e.target.value)} required /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Criar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
