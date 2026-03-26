import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Receipt, Fuel, UtensilsCrossed, Car, Wrench, ParkingCircle, Camera, Image } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
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

export default function DriverExpenses() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: 'fuel', amount: '', notes: '' });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: expenses = [] } = useQuery({
    queryKey: ['driver_expenses', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('driver_expenses')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('expense_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

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
      let receiptUrl: string | null = null;

      // Upload receipt photo if provided
      if (receiptFile && currentTenant) {
        const ext = receiptFile.name.split('.').pop() || 'jpg';
        const path = `${currentTenant.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('receipts')
          .upload(path, receiptFile, { contentType: receiptFile.type });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
        receiptUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from('driver_expenses').insert({
        tenant_id: currentTenant!.id,
        category: form.category,
        amount: parseFloat(form.amount) || 0,
        notes: form.notes || null,
        receipt_url: receiptUrl,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Despesa registrada' });
      setOpen(false);
      setForm({ category: 'fuel', amount: '', notes: '' });
      setReceiptFile(null);
      setReceiptPreview(null);
      qc.invalidateQueries({ queryKey: ['driver_expenses'] });
    },
    onError: (e: any) => {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Despesas</h1>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setReceiptFile(null); setReceiptPreview(null); } }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Nova Despesa</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Valor (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Observação</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Comprovante (foto)</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileSelect}
                />
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
              </div>
              <Button
                className="w-full"
                size="sm"
                onClick={() => createExpense.mutate()}
                disabled={!form.amount || createExpense.isPending}
              >
                {createExpense.isPending ? 'Salvando...' : 'Registrar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma despesa registrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {expenses.map((exp: any) => {
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
                    <Badge
                      variant={exp.approval_status === 'approved' ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
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
