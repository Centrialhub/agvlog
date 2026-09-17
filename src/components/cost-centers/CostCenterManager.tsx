
import { useRef, useState } from 'react';
import { useCostCenters, CostCenter } from '@/hooks/useCostCenters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Power, PowerOff, Trash2 } from 'lucide-react';

export function CostCenterManager() {
  const {
    fullData, isFullLoading, isFullError, refetchFull,
    addCostCenter, toggleCostCenter, deleteCostCenter,
    isAdding, togglingId, deletingId,
  } = useCostCenters();
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setNameError('Informe o nome do centro de custo.');
      nameInputRef.current?.focus();
      return;
    }

    try {
      await addCostCenter(newName.trim());
      setNewName('');
      setNameError('');
      setAddDialogOpen(false);
    } catch {
      // The mutation shows a contextual toast; keep the value so it can be corrected.
    }
  };

  const handleToggle = async (costCenter: CostCenter) => {
    try {
      await toggleCostCenter({ id: costCenter.id, active: !costCenter.active });
    } catch {
      // The mutation reports the failure without creating an unhandled promise.
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCostCenter(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Keep the dialog open so the user can choose to cancel or deactivate instead.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Cadastre e organize os centros de custo da empresa.</p>
          <p className="text-sm text-muted-foreground">O nome será validado antes de salvar.</p>
        </div>
        <Button type="button" onClick={() => setAddDialogOpen(true)} disabled={isAdding} className="min-h-11 w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> Novo centro de custo
        </Button>
      </div>

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (isAdding) return;
          setAddDialogOpen(open);
          if (!open) {
            setNewName('');
            setNameError('');
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo centro de custo</DialogTitle>
              <DialogDescription>Informe um nome para identificar onde os custos serão agrupados.</DialogDescription>
            </DialogHeader>
            <div>
              <Input
                ref={nameInputRef}
                autoFocus
                aria-label="Nome do centro de custo"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'cost-center-name-error' : undefined}
                placeholder="Ex.: Administrativo"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (nameError) setNameError('');
                }}
                disabled={isAdding}
              />
              {nameError ? (
                <p id="cost-center-name-error" role="alert" className="mt-1 text-sm text-destructive">
                  {nameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)} disabled={isAdding}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isAdding}>
                {isAdding ? 'Salvando…' : 'Salvar centro de custo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div>
        <Table scrollLabel="Centros de custo cadastrados" containerClassName="rounded-md border" className="min-w-[30rem]">
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
            ) : isFullError ? (
              <TableRow><TableCell colSpan={3} className="text-center py-4">
                <p role="alert">Não foi possível carregar os centros de custo.</p>
                <Button variant="link" onClick={() => void refetchFull()}>Tentar novamente</Button>
              </TableCell></TableRow>
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
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 sm:h-9 sm:w-9"
                        aria-label={cc.active ? `Desativar ${cc.name}` : `Ativar ${cc.name}`}
                        title={cc.active ? 'Desativar' : 'Ativar'}
                        disabled={togglingId === cc.id || deletingId === cc.id}
                        onClick={() => void handleToggle(cc)}
                      >
                        {cc.active ? <PowerOff className="h-4 w-4 text-orange-500" /> : <Power className="h-4 w-4 text-emerald-500" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 sm:h-9 sm:w-9"
                        aria-label={`Excluir ${cc.name}`}
                        title="Excluir"
                        disabled={togglingId === cc.id || deletingId === cc.id}
                        onClick={() => setDeleteTarget(cc)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deletingId && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir centro de custo?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” será excluído definitivamente. Se ele já estiver vinculado a despesas, preserve o histórico usando Desativar.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(deletingId)}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deletingId ? 'Excluindo…' : 'Excluir definitivamente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
