import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Wallet, ArrowUpRight, ArrowDownRight, Search, FileText } from 'lucide-react';

const fmtMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Ledger() {
  const { currentTenant } = useTenant();
  const [search, setSearch] = useState('');
  const [nature, setNature] = useState<'all' | 'credit' | 'debit'>('all');

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['operational_ledger', currentTenant?.id, search, nature],
    enabled: !!currentTenant,
    queryFn: async () => {
      let query = supabase
        .from('operational_ledger' as any)
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false });

      if (nature !== 'all') query = query.eq('nature', nature);
      if (search) query = query.ilike('metadata->>description', `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    }
  });

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" /> Livro Razão Operacional
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro imutável de todas as movimentações financeiras operacionais
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Créditos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {fmtMoney(entries.filter(e => e.nature === 'credit').reduce((s, e) => s + Number(e.amount), 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Débitos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {fmtMoney(entries.filter(e => e.nature === 'debit').reduce((s, e) => s + Number(e.amount), 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Saldo Operacional</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtMoney(entries.reduce((s, e) => s + (e.nature === 'credit' ? 1 : -1) * Number(e.amount), 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
            <CardTitle className="text-lg font-medium">Lançamentos</CardTitle>
            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input 
                  className="pl-8" 
                  placeholder="Buscar na descrição..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={nature} onValueChange={(v: any) => setNature(v)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Natureza" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="credit">Crédito</SelectItem>
                  <SelectItem value="debit">Débito</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
              ) : entries.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Nenhum lançamento encontrado.</TableCell></TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(entry.created_at), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {entry.entry_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {entry.source_table}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs truncate" title={entry.metadata?.description}>
                        {entry.metadata?.description || '—'}
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${entry.nature === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      <div className="flex items-center justify-end gap-1">
                        {entry.nature === 'credit' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {fmtMoney(entry.amount)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.status === 'active' ? 'secondary' : 'destructive'} className="text-[10px]">
                        {entry.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
