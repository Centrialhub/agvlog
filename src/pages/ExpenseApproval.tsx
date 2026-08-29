import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Receipt, CheckCircle, XCircle, Clock, ImageIcon, AlertTriangle, Wallet, Building2 } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type ExpenseApprovalRow = Tables<'driver_expenses'> & {
  drivers: Pick<Tables<'drivers'>, 'name'> | null;
};

type ApprovalStatus = 'approved' | 'rejected';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível atualizar a despesa.';
}

const CATEGORIES: Record<string, string> = {
  fuel: 'Combustível',
  food: 'Alimentação',
  toll: 'Pedágio',
  maintenance: 'Manutenção',
  parking: 'Estacionamento',
  other: 'Outro',
};

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  driver: 'Motorista (reembolsável)',
  advance: 'Adiantamento',
  company_card: 'Cartão da empresa',
  company_account: 'Conta da empresa',
  other: 'Outro',
};

export default function ExpenseApproval() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [receiptDialog, setReceiptDialog] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const { data: expenses = [] } = useQuery({
    queryKey: ['expense_approval', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('driver_expenses')
        .select('*, drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('expense_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Generate signed URL when viewing a receipt
  useEffect(() => {
    if (!receiptDialog) { setSignedUrl(null); return; }
    (async () => {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(receiptDialog, 300);
      if (!error && data) setSignedUrl(data.signedUrl);
    })();
  }, [receiptDialog]);

  const updateExpense = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ApprovalStatus }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase
        .from('driver_expenses')
        .update({
          approval_status: status,
          approved_by: user?.id || null,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Despesa atualizada' });
      qc.invalidateQueries({ queryKey: ['expense_approval'] });
      qc.invalidateQueries({ queryKey: ['ops_expenses_count'] });
    },
    onError: (error: unknown) => toast({ title: 'Erro', description: errorMessage(error), variant: 'destructive' }),
  });

  const pending = expenses.filter((expense) => expense.approval_status === 'pending');
  const reviewed = expenses.filter((expense) => expense.approval_status !== 'pending');

  const ExpenseCard = ({ exp, showActions }: { exp: ExpenseApprovalRow; showActions: boolean }) => (
    <Card key={exp.id}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{CATEGORIES[exp.category] || exp.category}</p>
              <Badge
                variant={exp.approval_status === 'approved' ? 'default' : exp.approval_status === 'rejected' ? 'destructive' : 'secondary'}
                className="text-[10px]"
              >
                {exp.approval_status === 'pending' ? 'Pendente' : exp.approval_status === 'approved' ? 'Aprovada' : 'Rejeitada'}
              </Badge>
              {exp.payment_source && exp.payment_source !== 'driver' && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Building2 className="h-3 w-3" />
                  {PAYMENT_SOURCE_LABELS[exp.payment_source] || exp.payment_source}
                </Badge>
              )}
              {exp.paid_with_advance && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Wallet className="h-3 w-3" /> Adiantamento
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {exp.drivers?.name || 'Motorista'} · {new Date(exp.expense_at).toLocaleDateString('pt-BR')}
              {(exp.city || exp.state) && ` · ${[exp.city, exp.state].filter(Boolean).join('/')}`}
            </p>
            {(exp.supplier_name || exp.document_number) && (
              <p className="text-xs text-muted-foreground">
                {exp.supplier_name || '—'}{exp.document_number ? ` · Doc ${exp.document_number}` : ''}
                {exp.odometer ? ` · ${Number(exp.odometer).toLocaleString('pt-BR')} km` : ''}
              </p>
            )}
            {exp.notes && <p className="text-xs text-muted-foreground">{exp.notes}</p>}
            {exp.no_receipt && (
              <div className="flex items-start gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Sem comprovante — {exp.no_receipt_reason || 'sem motivo informado'}</span>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold">R$ {Number(exp.amount).toFixed(2)}</p>
            {exp.receipt_url && (
              <button
                onClick={() => setReceiptDialog(exp.receipt_url)}
                className="text-xs text-primary flex items-center gap-1 justify-end mt-1 hover:underline"
              >
                <ImageIcon className="h-3 w-3" /> Ver comprovante
              </button>
            )}
            {exp.reimbursable === false && (
              <p className="text-[10px] text-muted-foreground mt-1">Não reembolsável</p>
            )}
          </div>
        </div>
        {showActions && (
          <div className="flex gap-2 mt-3 justify-end">
            <Button size="sm" variant="outline" className="text-xs text-destructive" onClick={() => updateExpense.mutate({ id: exp.id, status: 'rejected' })} disabled={updateExpense.isPending}>
              <XCircle className="h-3 w-3 mr-1" /> Rejeitar
            </Button>
            <Button size="sm" className="text-xs" onClick={() => updateExpense.mutate({ id: exp.id, status: 'approved' })} disabled={updateExpense.isPending}>
              <CheckCircle className="h-3 w-3 mr-1" /> Aprovar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Aprovação de Despesas</h1>
        <p className="text-sm text-muted-foreground">Revise e aprove as despesas dos motoristas</p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="text-xs">
            <Clock className="h-3 w-3 mr-1" /> Pendentes ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="reviewed" className="text-xs">
            <CheckCircle className="h-3 w-3 mr-1" /> Revisadas ({reviewed.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {pending.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma despesa pendente de aprovação.</p>
              </CardContent>
            </Card>
          ) : (
            pending.map((exp) => <ExpenseCard key={exp.id} exp={exp} showActions />)
          )}
        </TabsContent>

        <TabsContent value="reviewed" className="space-y-3 mt-4">
          {reviewed.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">Nenhuma despesa revisada.</p>
              </CardContent>
            </Card>
          ) : (
            reviewed.map((exp) => <ExpenseCard key={exp.id} exp={exp} showActions={false} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Receipt viewer dialog */}
      <Dialog open={!!receiptDialog} onOpenChange={() => setReceiptDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Comprovante</DialogTitle></DialogHeader>
          {signedUrl ? (
            <img src={signedUrl} alt="Comprovante" className="w-full rounded-md" />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
