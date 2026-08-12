import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Receipt, Fuel, UtensilsCrossed, Car, Wrench, ParkingCircle, Camera, Image, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

import { canUseDriverDemo } from '@/lib/driver/demoMode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';

const CATEGORIES = [
  { value: 'fuel', label: 'Combustível', icon: Fuel },
  { value: 'food', label: 'Alimentação', icon: UtensilsCrossed },
  { value: 'toll', label: 'Pedágio', icon: Car },
  { value: 'maintenance', label: 'Manutenção', icon: Wrench },
  { value: 'parking', label: 'Estacionamento', icon: ParkingCircle },
  { value: 'other', label: 'Outro', icon: Receipt },
];

const approvalLabels: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
};

const DEMO_EXPENSES_INITIAL: any[] = [
  { id: 'e1', category: 'fuel',     amount: 320.50, notes: 'Posto BR — 65L diesel S10', approval_status: 'approved', expense_at: new Date(Date.now() - 1*86400000).toISOString() },
  { id: 'e2', category: 'food',     amount: 35.00,  notes: 'Almoço no restaurante de beira de estrada', approval_status: 'pending',  expense_at: new Date(Date.now() - 2*3600000).toISOString() },
  { id: 'e3', category: 'toll',     amount: 18.40,  notes: 'Pedágio BR-365', approval_status: 'approved', expense_at: new Date(Date.now() - 4*3600000).toISOString() },
  { id: 'e4', category: 'parking',  amount: 12.00,  notes: 'Estacionamento Pirapora', approval_status: 'rejected', expense_at: new Date(Date.now() - 26*3600000).toISOString() },
];

export default function DriverExpenses() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: 'fuel',
    amount: '',
    notes: '',
    supplier_name: '',
    document_number: '',
    city: '',
    state: '',
    odometer: '',
    payment_source: 'driver',
    paid_with_advance: false,
    no_receipt: false,
    no_receipt_reason: '',
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [demoExpenses, setDemoExpenses] = useState<any[]>(DEMO_EXPENSES_INITIAL);

  const { data: expenses = [] } = useQuery({
    queryKey: ['driver_expenses', driver?.id],
    queryFn: async () => {
      if (!currentTenant || !driver) return [];
      const { data, error } = await supabase
        .from('driver_expenses')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('driver_id', driver.id)
        .order('expense_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && !!driver,
  });

  // Realtime: refresh when operator approves/rejects or updates expenses.
  useEffect(() => {
    if (!driver?.id) return;
    const channel = supabase
      .channel(`driver_expenses_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_expenses', filter: `driver_id=eq.${driver.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_expenses'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, qc]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = () => setReceiptPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const createExpense = useMutation({
    mutationFn: async () => {
      if (!currentTenant || !driver) {
        // Demo
        setDemoExpenses((prev) => [{
          id: 'd' + Date.now(),
          category: form.category,
          amount: parseFloat(form.amount) || 0,
          notes: form.notes || null,
          approval_status: 'pending',
          expense_at: new Date().toISOString(),
        }, ...prev]);
        return;
      }
      if (!trip) throw new Error('Sem viagem ativa para vincular a despesa.');

      let receiptPath: string | null = null;
      if (receiptFile) {
        const ext = receiptFile.name.split('.').pop() || 'jpg';
        const path = `${currentTenant.id}/expenses/${trip.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('receipts')
          .upload(path, receiptFile, { contentType: receiptFile.type });
        if (uploadErr) throw uploadErr;
        receiptPath = path;
      }

      const { error } = await supabase.rpc('driver_create_expense', {
        _trip_id: trip.id,
        _category: form.category,
        _amount: parseFloat(form.amount) || 0,
        _notes: form.notes || null,
        _receipt_path: receiptPath,
        _supplier_name: form.supplier_name || null,
        _document_number: form.document_number || null,
        _city: form.city || null,
        _state: form.state || null,
        _odometer: form.odometer ? parseFloat(form.odometer) : null,
        _no_receipt: form.no_receipt,
        _no_receipt_reason: form.no_receipt ? (form.no_receipt_reason || null) : null,
        _paid_with_advance: form.paid_with_advance,
        _payment_source: form.payment_source,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Despesa registrada' });
      setOpen(false);
      setForm({
        category: 'fuel', amount: '', notes: '',
        supplier_name: '', document_number: '', city: '', state: '', odometer: '',
        payment_source: 'driver', paid_with_advance: false,
        no_receipt: false, no_receipt_reason: '',
      });
      setReceiptFile(null);
      setReceiptPreview(null);
      qc.invalidateQueries({ queryKey: ['driver_expenses'] });
    },
    onError: (e: any) => {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    },
  });

  const isDemo = false;
  const effectiveExpenses = expenses;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Despesas</h1>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setReceiptFile(null); setReceiptPreview(null); } }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nova Despesa</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Valor (R$)</Label>
                <Input type="number" step="0.01" placeholder="0,00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Origem do pagamento</Label>
                <Select value={form.payment_source} onValueChange={v => setForm(f => ({ ...f, payment_source: v, paid_with_advance: v === 'advance' ? true : f.paid_with_advance }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="driver">Motorista (reembolsável)</SelectItem>
                    <SelectItem value="advance">Adiantamento</SelectItem>
                    <SelectItem value="company_card">Cartão da empresa</SelectItem>
                    <SelectItem value="company_account">Conta da empresa</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Fornecedor</Label>
                  <Input value={form.supplier_name} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} className="h-9" placeholder="Ex: Posto Shell" />
                </div>
                <div>
                  <Label className="text-xs">Nº documento</Label>
                  <Input value={form.document_number} onChange={e => setForm(f => ({ ...f, document_number: e.target.value }))} className="h-9" placeholder="Cupom / NF" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">Cidade</Label>
                  <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">UF</Label>
                  <Input maxLength={2} value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} className="h-9" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Hodômetro (km)</Label>
                <Input type="number" step="0.1" value={form.odometer} onChange={e => setForm(f => ({ ...f, odometer: e.target.value }))} className="h-9" placeholder="Opcional" />
              </div>
              <div>
                <Label className="text-xs">Observação</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Comprovante (foto)</Label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
                <div className="flex gap-2 mt-1">
                  <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => fileRef.current?.click()}>
                    <Camera className="h-3.5 w-3.5 mr-1" /> {receiptFile ? 'Trocar' : 'Tirar foto'}
                  </Button>
                  {receiptPreview && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Image className="h-3 w-3" /> Foto selecionada
                    </div>
                  )}
                </div>
                {receiptPreview && (
                  <img src={receiptPreview} alt="Comprovante" className="mt-2 rounded-md max-h-32 object-cover" />
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Checkbox id="no_receipt" checked={form.no_receipt} onCheckedChange={(v) => setForm(f => ({ ...f, no_receipt: !!v }))} />
                  <label htmlFor="no_receipt" className="text-xs text-muted-foreground">Sem comprovante</label>
                </div>
                {form.no_receipt && (
                  <div className="mt-1">
                    <Label className="text-xs flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> Motivo (obrigatório)
                    </Label>
                    <Input value={form.no_receipt_reason} onChange={e => setForm(f => ({ ...f, no_receipt_reason: e.target.value }))} className="h-9" placeholder="Ex: cupom perdido" />
                  </div>
                )}
              </div>
              {trip && (
                <p className="text-[10px] text-muted-foreground">
                  Vinculada à viagem da carga {(trip as any).loads?.load_number || ''}
                </p>
              )}
              <Button
                className="w-full"
                size="sm"
                onClick={() => createExpense.mutate()}
                disabled={!form.amount || createExpense.isPending || (form.no_receipt && !form.no_receipt_reason.trim())}
              >
                {createExpense.isPending ? 'Salvando...' : 'Registrar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>


      {effectiveExpenses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma despesa registrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {effectiveExpenses.map((exp: any) => {
            const cat = CATEGORIES.find(c => c.value === exp.category);
            const Icon = cat?.icon || Receipt;
            return (
              <Card key={exp.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{cat?.label || exp.category}</p>
                    {exp.notes && <p className="text-xs text-muted-foreground truncate">{exp.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">R$ {Number(exp.amount).toFixed(2)}</p>
                    <Badge variant={exp.approval_status === 'approved' ? 'default' : 'secondary'} className="text-[10px]">
                      {approvalLabels[exp.approval_status] || exp.approval_status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
