import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthorizedCteList } from '@/hooks/useAuthorizedCteList';
import { useVehicles } from '@/hooks/useVehicles';
import { useEmitters } from '@/hooks/useEmitters';
import { supabase } from '@/integrations/supabase/client';
import { buildMdfePayload, BuildMdfePayloadInput } from '@/lib/fiscal/mdfeBuilder';
import { format } from 'date-fns';
import { Loader2, Send, RefreshCw, XCircle, FileText, Truck, User, MapPin } from 'lucide-react';
import { toast } from 'sonner';

export default function MdfeProvisional() {
  const { data: ctes, isLoading, refetch } = useAuthorizedCteList();
  const { data: vehicles = [] } = useVehicles();
  const { data: emitters = [] } = useEmitters();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);

  // Form states
  const [emitterId, setEmitterId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [driverName, setDriverName] = useState('');
  const [driverCpf, setDriverCpf] = useState('');
  const [originCity, setOriginCity] = useState('SAO PAULO');
  const [originIbge, setOriginIbge] = useState('3550308');
  const [originUf, setOriginUf] = useState('35');
  const [destCity, setDestCity] = useState('');
  const [destIbge, setDestIbge] = useState('');
  const [destUf, setDestUf] = useState('');

  // Auto-fill from selected CTEs
  useEffect(() => {
    if (isDialogOpen && selectedIds.length > 0) {
      const firstSelected = ctes?.find(c => c.id === selectedIds[0]);
      if (firstSelected) {
        setDestCity(firstSelected.recipient_city || '');
      }
      if (emitters.length > 0 && !emitterId) {
        const def = emitters.find(e => e.is_default) || emitters[0];
        setEmitterId(def.id);
      }
    }
  }, [isDialogOpen, selectedIds, ctes, emitters, emitterId]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === (ctes?.length || 0)) {
      setSelectedIds([]);
    } else {
      setSelectedIds(ctes?.map(c => c.id) || []);
    }
  };

  const handleOpenDialog = () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos um CT-e");
      return;
    }
    setIsDialogOpen(true);
  };

  const handleTransmit = async () => {
    const emitter = emitters.find(e => e.id === emitterId);
    const vehicle = vehicles.find(v => v.id === vehicleId);

    if (!emitter || !vehicle || !driverCpf || !originIbge || !destIbge) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsTransmitting(true);
    try {
      const selectedDocs = ctes?.filter(c => selectedIds.includes(c.id)) || [];
      
      const input: BuildMdfePayloadInput = {
        emitter: {
          cnpj: emitter.cnpj,
          name: emitter.razao_social,
          environment: 'sandbox',
        },
        driver: {
          name: driverName,
          cpf: driverCpf,
        },
        vehicle: {
          plate: vehicle.plate,
          state: vehicle.type || 'SP',
        },
        origin: {
          city_ibge: originIbge,
          city_name: originCity,
          state: originUf,
        },
        destination: {
          city_ibge: destIbge,
          city_name: destCity,
          state: destUf,
        },
        documents: selectedDocs.map(d => ({
          key: d.access_key!,
          type: 'cte'
        }))
      };

      const { ok, payload, missing } = buildMdfePayload(input);
      if (!ok) {
        toast.error(`Dados ausentes: ${missing.join(', ')}`);
        return;
      }

      const { data, error } = await supabase.functions.invoke('hub-fiscal-proxy', {
        body: { 
          type: 'mdfe',
          action: 'emit',
          emitterId: emitter.id,
          body: payload 
        }
      });

      if (error) throw error;
      
      toast.success("MDF-e enviado para processamento");
      setIsDialogOpen(false);
      setSelectedIds([]);
      refetch();
    } catch (err: any) {
      console.error(err);
      toast.error(`Falha na transmissão: ${err.message}`);
    } finally {
      setIsTransmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MDF-e (Provisório)</h1>
          <p className="text-muted-foreground">
            Selecione CT-es autorizados para vincular ao manifesto.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Sincronizar
          </Button>
          <Button 
            disabled={selectedIds.length === 0}
            onClick={handleOpenDialog}
          >
            <Send className="mr-2 h-4 w-4" />
            Gerar Manifesto ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CT-es Disponíveis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{ctes?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Selecionados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{selectedIds.length}</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status Motor</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge className="bg-green-500/10 text-green-500">Engine v1 Ativa</Badge>
            <span className="text-xs text-muted-foreground">Pronto para homologação</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>CT-es Autorizados</CardTitle>
          <CardDescription>
            Apenas documentos com status 'Autorizado' podem ser vinculados ao MDF-e.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : ctes && ctes.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox 
                        checked={ctes.length > 0 && selectedIds.length === ctes.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Remetente / Destinatário</TableHead>
                    <TableHead>Cidade Destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ctes.map((cte) => (
                    <TableRow key={cte.id} className={selectedIds.includes(cte.id) ? "bg-muted/50" : ""}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.includes(cte.id)}
                          onCheckedChange={() => toggleSelect(cte.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {cte.cte_number || '---'}
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">
                          {cte.access_key}
                        </div>
                      </TableCell>
                      <TableCell>
                        {cte.issued_at ? format(new Date(cte.issued_at), 'dd/MM/yyyy') : '---'}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium truncate max-w-[200px]">{cte.remitter}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{cte.recipient}</div>
                      </TableCell>
                      <TableCell>{cte.recipient_city}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium">Nenhum CT-e autorizado encontrado</h3>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Finalizar MDF-e</DialogTitle>
            <DialogDescription>
              Preencha as informações complementares da viagem para transmitir o manifesto.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" /> Emitente e Veículo
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Emitente</Label>
                  <Select value={emitterId} onValueChange={setEmitterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o emitente" />
                    </SelectTrigger>
                    <SelectContent>
                      {emitters.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Veículo (Placa)</Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o veículo" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `(${v.nickname})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <User className="h-4 w-4" /> Condutor
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome Completo</Label>
                  <Input value={driverName} onChange={e => setDriverName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>CPF (Somente números)</Label>
                  <Input value={driverCpf} onChange={e => setDriverCpf(e.target.value)} placeholder="00000000000" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4" /> Rota
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Origem (Cidade)</Label>
                  <Input value={originCity} onChange={e => setOriginCity(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>IBGE Origem</Label>
                  <Input value={originIbge} onChange={e => setOriginIbge(e.target.value)} placeholder="Ex: 3550308" />
                </div>
                <div className="space-y-2">
                  <Label>UF/Código UF</Label>
                  <Input value={originUf} onChange={e => setOriginUf(e.target.value)} placeholder="Ex: 35" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Destino (Cidade)</Label>
                  <Input value={destCity} onChange={e => setDestCity(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>IBGE Destino</Label>
                  <Input value={destIbge} onChange={e => setDestIbge(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>UF/Código UF</Label>
                  <Input value={destUf} onChange={e => setDestUf(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button disabled={isTransmitting} onClick={handleTransmit}>
              {isTransmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar e Transmitir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
