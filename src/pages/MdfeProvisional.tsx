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
import { useEmitters, useHubCredentials } from '@/hooks/useEmitters';
import { supabase } from '@/integrations/supabase/client';
import { buildMdfePayload, BuildMdfePayloadInput } from '@/lib/fiscal/mdfeBuilder';
import { useInsuranceProfile } from '@/hooks/useInsuranceProfile';
import { format } from 'date-fns';
import { Loader2, Send, RefreshCw, XCircle, FileText, Truck, User, MapPin } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

export default function MdfeProvisional() {
  const { data: ctes, isLoading, refetch } = useAuthorizedCteList();
  const { data: vehicles = [] } = useVehicles();
  const { data: emitters = [] } = useEmitters();
  const { data: insurance } = useInsuranceProfile();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);

  // Form states
  const [emitterId, setEmitterId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [driverName, setDriverName] = useState('HAMILTON SANTOS RAMOS');
  const [driverCpf, setDriverCpf] = useState('07044266681');
  const [originCity, setOriginCity] = useState('MONTES CLAROS');
  const [originIbge, setOriginIbge] = useState('3143302');
  const [originUf, setOriginUf] = useState('31');
  const [destCity, setDestCity] = useState('');
  const [destIbge, setDestIbge] = useState('');
  const [destUf, setDestUf] = useState('');
  const [vehicleTara, setVehicleTara] = useState('');
  const [totalCargoValue, setTotalCargoValue] = useState('');
  const [totalCargoWeight, setTotalCargoWeight] = useState('');
  const [vehicleRenavam, setVehicleRenavam] = useState('');
  
  // Vale Pedágio
  const [includeValePedagio, setIncludeValePedagio] = useState(false);
  const [vpFornCnpj, setVpFornCnpj] = useState('04898488000177'); // Padrão observado no PDF
  const [vpComprovante, setVpComprovante] = useState('');
  const [vpValor, setVpValor] = useState('');

  // Grupo de pagamento do tomador (Nota Técnica de piso mínimo de frete)
  const [includePayment, setIncludePayment] = useState(false);
  const [payName, setPayName] = useState('');
  const [payDoc, setPayDoc] = useState('');
  const [payIe, setPayIe] = useState('');
  const [payStreet, setPayStreet] = useState('');
  const [payNumber, setPayNumber] = useState('');
  const [payNeighborhood, setPayNeighborhood] = useState('');
  const [payCity, setPayCity] = useState('');
  const [payCityIbge, setPayCityIbge] = useState('');
  const [payState, setPayState] = useState('');
  const [payZip, setPayZip] = useState('');
  const [payContractValue, setPayContractValue] = useState('');
  const [payCondition, setPayCondition] = useState<'avista' | 'aprazo'>('avista');
  const [payAdvance, setPayAdvance] = useState('');
  const [payPix, setPayPix] = useState('');
  const [payBankCode, setPayBankCode] = useState('');
  const [payAgency, setPayAgency] = useState('');
  const [payAccount, setPayAccount] = useState('');
  const [payIpefCnpj, setPayIpefCnpj] = useState('');
  const [includeProprietor, setIncludeProprietor] = useState(false);
  const [propName, setPropName] = useState('');
  const [propDoc, setPropDoc] = useState('');
  const [propIe, setPropIe] = useState('');
  const [propState, setPropState] = useState('');
  const [propRntrc, setPropRntrc] = useState('');
  const [propType, setPropType] = useState<'0' | '1' | '2'>('2');
  const [payInstallments, setPayInstallments] = useState<Array<{ dueDate: string; value: string }>>([
    { dueDate: '', value: '' },
  ]);
  const { data: hubCredentials = [] } = useHubCredentials(emitterId);

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
      if (vehicles.length > 0 && !vehicleId) {
        const targetVehicle = vehicles.find(v => v.plate?.toUpperCase() === 'GVJ3744');
        if (targetVehicle) {
          setVehicleId(targetVehicle.id);
          setVehicleTara((targetVehicle as any).tara_kg?.toString() || '');
          setVehicleRenavam((targetVehicle as any).renavam || '');
        }
      }
      
      const selectedDocs = ctes?.filter(c => selectedIds.includes(c.id)) || [];
      const total = selectedDocs.reduce((acc, doc) => acc + (doc.cargo_value || 0), 0);
      const totalWeight = selectedDocs.reduce((acc, doc) => acc + (doc.cargo_weight || 0), 0);
      
      setTotalCargoValue(total.toFixed(2));
      setTotalCargoWeight(totalWeight.toFixed(3));

      // Pré-preenche o tomador com o fornecedor (Remetente) do primeiro documento selecionado
      const first = selectedDocs[0];
      if (first) {
        setPayName(prev => prev || first.remitter || '');
        setPayDoc(prev => prev || first.remitter_cnpj || '');
        
        // Se o tomador ainda não tem endereço preenchido, tentamos buscar no primeiro CT-e
        if (!payStreet && first.remitter_street) setPayStreet(first.remitter_street);
        if (!payNumber && first.remitter_number) setPayNumber(first.remitter_number);
        if (!payNeighborhood && first.remitter_neighborhood) setPayNeighborhood(first.remitter_neighborhood);
        if (!payZip && first.remitter_zip) setPayZip(first.remitter_zip);
        if (!payCity && first.remitter_city) setPayCity(first.remitter_city);
        if (!payState && first.remitter_uf) setPayState(first.remitter_uf);
        if (!payCityIbge && first.remitter_city_ibge) setPayCityIbge(first.remitter_city_ibge);
        if (!payIe && first.remitter_ie) setPayIe(first.remitter_ie);
      }
    }
  }, [isDialogOpen, selectedIds, ctes, emitters, emitterId, vehicles, vehicleId]);

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
    const mdfeCredential = hubCredentials.find(c => c.enabled && c.doc_scope === 'mdfe')
      || hubCredentials.find(c => c.enabled && c.doc_scope === 'all');

    if (!emitter || !vehicle || !driverCpf || !originIbge || !destIbge || !vehicleTara) {
      toast.error("Preencha todos os campos obrigatórios (incluindo a Tara do Veículo)");
      return;
    }

    if (!mdfeCredential) {
      toast.error("O emitente selecionado não possui credencial habilitada para MDF-e");
      return;
    }

    if (!insurance?.cnpj || !insurance?.policy || !insurance?.name) {
      toast.error("Configure os dados da seguradora em Configurações > Empresa antes de emitir o MDF-e");
      return;
    }

    setIsTransmitting(true);
    try {
      const selectedDocs = ctes?.filter(c => selectedIds.includes(c.id)) || [];

      // A lista pode estar em cache sem a chave; busca o valor atual no banco.
      const needsKey = selectedDocs.filter(doc => !/^\d{44}$/.test(doc.access_key || '')).map(d => d.id);
      if (needsKey.length > 0) {
        const { data: fresh } = await supabase
          .from('fiscal_documents')
          .select('id, access_key')
          .in('id', needsKey);
        for (const row of fresh || []) {
          const target = selectedDocs.find(d => d.id === row.id);
          if (target && /^\d{44}$/.test(String(row.access_key || ''))) {
            target.access_key = String(row.access_key);
          }
        }
      }

      const invalidDocuments = selectedDocs.filter(doc => !/^\d{44}$/.test(doc.access_key || ''));
      if (invalidDocuments.length > 0) {
        toast.error(
          `${invalidDocuments.length} CT-e sem chave de acesso de 44 dígitos (CT-e ${invalidDocuments
            .map(d => d.cte_number || d.id.slice(0, 8))
            .join(', ')}). Sincronize o CT-e com o Hub antes de emitir o MDF-e.`
        );
        return;
      }
      
      const input: BuildMdfePayloadInput = {
        emitter: {
          cnpj: emitter.cnpj,
          name: emitter.razao_social,
          environment: mdfeCredential.environment,
        },
        driver: {
          name: driverName,
          cpf: driverCpf,
        },
        vehicle: {
          plate: vehicle.plate,
          state: vehicle.uf || emitter.endereco?.uf || '',
          tara: Number(vehicleTara) || (vehicle as any).tara_kg || 0,
          renavam: vehicleRenavam || (vehicle as any).renavam || '',
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
        })),
        insurance: {
          providerName: insurance?.name || '',
          providerCnpj: insurance?.cnpj || '',
          policyNumber: insurance?.policy || '',
        },
        valCarga: Number(totalCargoValue) || 0,
        pesoBruto: Number(totalCargoWeight) || 0,
        cMone: '098',
        takers: Array.from(new Map(
          selectedDocs.map(d => [d.remitter_cnpj, { 
            cnpj: d.remitter_cnpj || '', 
            name: d.remitter || '',
            ie: d.remitter_ie || 'ISENTO',
            address: {
              street: d.remitter_street,
              number: d.remitter_number,
              neighborhood: d.remitter_neighborhood,
              city_ibge: d.remitter_city_ibge,
              city_name: d.remitter_city,
              state: d.remitter_uf,
              zip: d.remitter_zip
            }
          }])
        ).values()).filter(t => t.cnpj),
        payment: includePayment
          ? {
              contractorName: payName,
              contractorDoc: payDoc,
              contractorIe: payIe,
              contractorAddress: {
                street: payStreet,
                number: payNumber,
                neighborhood: payNeighborhood,
                city_ibge: payCityIbge,
                city_name: payCity,
                state: payState,
                zip: payZip,
              },
              contractValue: Number(payContractValue) || 0,
              paymentCondition: payCondition,
              advanceValue: Number(payAdvance) || 0,
              installments:
                payCondition === 'aprazo'
                  ? payInstallments
                      .filter(p => p.dueDate || p.value)
                      .map((p, idx) => ({
                        number: idx + 1,
                        dueDate: p.dueDate,
                        value: Number(p.value) || 0,
                      }))
                  : [],
              bank: {
                pixKey: payPix,
                bankCode: payBankCode,
                agency: payAgency,
                account: payAccount,
                ipefCnpj: payIpefCnpj,
              },
            }
          : null,
        proprietor: includeProprietor
          ? {
              name: propName,
              cnpj: propDoc.length > 11 ? propDoc : null,
              cpf: propDoc.length <= 11 ? propDoc : null,
              ie: propIe,
              state: propState,
              rntrc: propRntrc,
              type: propType,
            }
          : null,
        valePedagio: includeValePedagio ? {
          cnpjFornecedor: vpFornCnpj,
          numeroComprovante: vpComprovante,
          valor: Number(vpValor) || 0
        } : null
      };

      const { ok, payload, missing } = buildMdfePayload(input);
      if (!ok) {
        toast.error(`Dados ausentes: ${missing.join(', ')}`);
        return;
      }

      console.log('[MdfeProvisional] Payload final para o Hub:', JSON.stringify(payload, null, 2));


      const { data, error } = await supabase.functions.invoke('hub-fiscal-proxy', {
        body: { 
          type: 'mdfe',
          action: 'emit',
          emitterId: emitter.id,
          body: payload 
        }
      });

      if (error) throw error;
      if (!data?.success) {
        const hubMessage = data?.hub?.error?.message
          || data?.error?.message
          || data?.emission?.message
          || (typeof data?.hub === 'string' ? data.hub : null)
          || 'O Hub Fiscal recusou a emissão';
        throw new Error(hubMessage);
      }
      
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
          <h1 className="text-2xl font-bold tracking-tight">Emissão de MDF-e</h1>
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
            <Badge className="bg-green-500/10 text-green-500">Engine v2.9 (Beta)</Badge>
            <span className="text-xs text-muted-foreground">Chaves no descarregamento do Hub</span>
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
                <div className="space-y-2">
                  <Label>Tara do Veículo (KG)</Label>
                  <Input 
                    type="number" 
                    value={vehicleTara} 
                    onChange={e => setVehicleTara(e.target.value)} 
                    placeholder="Ex: 5000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>RENAVAM</Label>
                  <Input 
                    value={vehicleRenavam} 
                    onChange={e => setVehicleRenavam(e.target.value)} 
                    placeholder="Somente números"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Peso Bruto Total (KG)</Label>
                  <Input 
                    type="number" 
                    value={totalCargoWeight} 
                    onChange={e => setTotalCargoWeight(e.target.value)} 
                    placeholder="Ex: 3682.63"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Valor Total da Carga (R$)</Label>
                  <Input 
                    type="number" 
                    value={totalCargoValue} 
                    onChange={e => setTotalCargoValue(e.target.value)} 
                    placeholder="Ex: 51165.88"
                  />
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

            {insurance && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-2 border">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Truck className="h-3 w-3" /> Seguro de Carga (Responsável: Emitente)
                </h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="text-muted-foreground">Seguradora:</div>
                  <div className="font-medium">{insurance.name}</div>
                  <div className="text-muted-foreground">CNPJ:</div>
                  <div className="font-medium font-mono">{insurance.cnpj}</div>
                  <div className="text-muted-foreground">Apólice:</div>
                  <div className="font-medium font-mono">{insurance.policy}</div>
                </div>
              </div>
            )}

            <div className="space-y-4 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="mdfe-include-payment"
                  checked={includePayment}
                  onCheckedChange={v => setIncludePayment(Boolean(v))}
                />
                <div>
                  <Label htmlFor="mdfe-include-payment" className="cursor-pointer">
                    Informar grupo de pagamento do tomador (piso mínimo de frete)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Em carga fracionada (múltiplos CT-e), a exigência normalmente é dispensada.
                  </p>
                </div>
              </div>

              {includePayment && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome / Razão Social do Tomador</Label>
                      <Input value={payName} onChange={e => setPayName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>CPF ou CNPJ do Tomador</Label>
                      <Input value={payDoc} onChange={e => setPayDoc(e.target.value)} placeholder="Somente números" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>IE do Tomador</Label>
                      <Input value={payIe} onChange={e => setPayIe(e.target.value)} placeholder="Somente números ou ISENTO" />
                    </div>
                    <div className="space-y-2">
                      <Label>CEP do Tomador</Label>
                      <Input value={payZip} onChange={e => setPayZip(e.target.value)} placeholder="00000000" />
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-8 space-y-2">
                      <Label>Endereço (Logradouro)</Label>
                      <Input value={payStreet} onChange={e => setPayStreet(e.target.value)} />
                    </div>
                    <div className="col-span-4 space-y-2">
                      <Label>Número</Label>
                      <Input value={payNumber} onChange={e => setPayNumber(e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-5 space-y-2">
                      <Label>Bairro</Label>
                      <Input value={payNeighborhood} onChange={e => setPayNeighborhood(e.target.value)} />
                    </div>
                    <div className="col-span-5 space-y-2">
                      <Label>Município (Nome)</Label>
                      <Input value={payCity} onChange={e => setPayCity(e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>UF</Label>
                      <Input value={payState} onChange={e => setPayState(e.target.value)} placeholder="Ex: MG" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>IBGE Município</Label>
                      <Input value={payCityIbge} onChange={e => setPayCityIbge(e.target.value)} placeholder="7 dígitos" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Valor Total do Contrato (R$)</Label>
                      <Input
                        type="number"
                        value={payContractValue}
                        onChange={e => setPayContractValue(e.target.value)}
                        placeholder="Ex: 3500.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Condição de Pagamento</Label>
                      <Select value={payCondition} onValueChange={(v: 'avista' | 'aprazo') => setPayCondition(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="avista">À vista</SelectItem>
                          <SelectItem value="aprazo">A prazo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Adiantamento (R$)</Label>
                      <Input
                        type="number"
                        value={payAdvance}
                        onChange={e => setPayAdvance(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Dados de Recebimento
                    </Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Chave Pix</Label>
                        <Input value={payPix} onChange={e => setPayPix(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>CNPJ da Instituição de Pagamento (IPEF)</Label>
                        <Input value={payIpefCnpj} onChange={e => setPayIpefCnpj(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Banco</Label>
                        <Input value={payBankCode} onChange={e => setPayBankCode(e.target.value)} placeholder="Ex: 001" />
                      </div>
                      <div className="space-y-2">
                        <Label>Agência</Label>
                        <Input value={payAgency} onChange={e => setPayAgency(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Conta</Label>
                        <Input value={payAccount} onChange={e => setPayAccount(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  {payCondition === 'aprazo' && (
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parcelas</Label>
                      {payInstallments.map((p, idx) => (
                        <div key={idx} className="flex items-end gap-2">
                          <div className="space-y-1 flex-1">
                            <Label className="text-xs">Vencimento {idx + 1}</Label>
                            <Input
                              type="date"
                              value={p.dueDate}
                              onChange={e =>
                                setPayInstallments(prev =>
                                  prev.map((it, i) => (i === idx ? { ...it, dueDate: e.target.value } : it))
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1 flex-1">
                            <Label className="text-xs">Valor (R$)</Label>
                            <Input
                              type="number"
                              value={p.value}
                              onChange={e =>
                                setPayInstallments(prev =>
                                  prev.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it))
                                )
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setPayInstallments(prev => prev.filter((_, i) => i !== idx))}
                            disabled={payInstallments.length === 1}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPayInstallments(prev => [...prev, { dueDate: '', value: '' }])}
                      >
                        Adicionar parcela
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Proprietário do Veículo */}
            <div className="space-y-4 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="mdfe-include-prop"
                  checked={includeProprietor}
                  onCheckedChange={v => setIncludeProprietor(Boolean(v))}
                />
                <div>
                  <Label htmlFor="mdfe-include-prop" className="cursor-pointer">
                    Informar Proprietário do Veículo (Se não for o emitente)
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Obrigatório quando o veículo não pertence ao emitente.
                  </p>
                </div>
              </div>

              {includeProprietor && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Razão Social / Nome</Label>
                    <Input
                      value={propName}
                      onChange={e => setPropName(e.target.value)}
                      placeholder="Nome do proprietário"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">CPF/CNPJ</Label>
                    <Input
                      value={propDoc}
                      onChange={e => setPropDoc(e.target.value)}
                      placeholder="Apenas números"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">IE</Label>
                    <Input
                      value={propIe}
                      onChange={e => setPropIe(e.target.value)}
                      placeholder="ISENTO"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">UF</Label>
                    <Input
                      value={propState}
                      onChange={e => setPropState(e.target.value.toUpperCase())}
                      placeholder="MG"
                      maxLength={2}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">RNTRC</Label>
                    <Input
                      value={propRntrc}
                      onChange={e => setPropRntrc(e.target.value)}
                      placeholder="Número RNTRC"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select value={propType} onValueChange={(v: any) => setPropType(v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0 - TAC Agregado</SelectItem>
                        <SelectItem value="1">1 - TAC Independente</SelectItem>
                        <SelectItem value="2">2 - Outros</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="mdfe-include-valeped"
                  checked={includeValePedagio}
                  onCheckedChange={v => setIncludeValePedagio(Boolean(v))}
                />
                <div>
                  <Label htmlFor="mdfe-include-valeped" className="cursor-pointer">
                    Informar Vale-Pedágio
                  </Label>
                </div>
              </div>

              {includeValePedagio && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <Label>CNPJ Fornecedor ANTT</Label>
                    <Input value={vpFornCnpj} onChange={e => setVpFornCnpj(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Nº Comprovante</Label>
                    <Input value={vpComprovante} onChange={e => setVpComprovante(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Valor (R$)</Label>
                    <Input type="number" value={vpValor} onChange={e => setVpValor(e.target.value)} />
                  </div>
                </div>
              )}
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
