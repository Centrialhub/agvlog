
import { useState } from 'react';
import { useCostCenters, CostCenter } from '@/hooks/useCostCenters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, Power, PowerOff } from 'lucide-react';

export function CostCenterManager() {
  const { fullData, isFullLoading, addCostCenter, toggleCostCenter } = useCostCenters();
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsSubmitting(true);
    try {
      await addCostCenter(newName.trim());
      setNewName('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Nome do centro de custo (ex: Administrativo)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={isSubmitting}
        />
        <Button type="submit" disabled={isSubmitting}>
          <Plus className="h-4 w-4 mr-2" /> Adicionar
        </Button>
      </form>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFullLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-4">Carregando...</TableCell></TableRow>
            ) : fullData.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">Nenhum centro de custo cadastrado.</TableCell></TableRow>
            ) : (
              fullData.map((cc: CostCenter) => (
                <TableRow key={cc.id}>
                  <TableCell className="font-medium">{cc.name}</TableCell>
                  <TableCell>
                    <Badge variant={cc.active ? "secondary" : "outline"}>
                      {cc.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => toggleCostCenter({ id: cc.id, active: !cc.active })}
                    >
                      {cc.active ? <PowerOff className="h-4 w-4 text-orange-500" /> : <Power className="h-4 w-4 text-emerald-500" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
