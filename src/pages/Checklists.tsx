import { useState, useMemo } from 'react';
import {
  useOperationalChecklists, useCreateChecklist,
  useChecklistExecutions, useCreateChecklistExecution,
  OperationalChecklist, ChecklistExecution,
  CHECKLIST_TYPES, CHECKLIST_TYPE_LABELS,
  EXECUTION_STATUS_LABELS,
} from '@/hooks/useOperationalChecklists';
import { useVehicles } from '@/hooks/useVehicles';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, ClipboardCheck, Play, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { format, parseISO } from 'date-fns';

const DEFAULT_ITEMS: Record<string, { key: string; label: string; required: boolean }[]> = {
  pre_trip: [
    { key: 'documents', label: 'Documentos do veículo em dia', required: true },
    { key: 'tires', label: 'Pneus em bom estado', required: true },
    { key: 'lights', label: 'Faróis e lanternas funcionando', required: true },
    { key: 'mirrors', label: 'Espelhos retrovisores', required: true },
    { key: 'brakes', label: 'Freios testados', required: true },
    { key: 'oil', label: 'Nível de óleo verificado', required: false },
    { key: 'fuel', label: 'Combustível suficiente', required: false },
    { key: 'fire_ext', label: 'Extintor de incêndio válido', required: true },
  ],
  post_trip: [
    { key: 'damages', label: 'Sem avarias novas', required: true },
    { key: 'interior', label: 'Interior limpo e organizado', required: false },
    { key: 'cargo_area', label: 'Área de carga vazia/limpa', required: true },
    { key: 'equipment', label: 'Equipamentos devolvidos', required: true },
    { key: 'fuel_report', label: 'Nível de combustível reportado', required: false },
  ],
};

export default function Checklists() {
  const { data: checklists = [], isLoading: loadingChecklists } = useOperationalChecklists();
  const { data: executions = [] } = useChecklistExecutions();
  const { data: vehicles = [] } = useVehicles();
  const { data: employees = [] } = useEmployees();
  const createChecklist = useCreateChecklist();
  const createExecution = useCreateChecklistExecution();

  const [tab, setTab] = useState('templates');
  const [templateDialog, setTemplateDialog] = useState(false);
  const [execDialog, setExecDialog] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState<OperationalChecklist | null>(null);
  const [execItems, setExecItems] = useState<{ key: string; label: string; status: 'ok' | 'nok' | 'na'; notes?: string }[]>([]);
  const [execForm, setExecForm] = useState({ vehicle_id: '', employee_id: '', notes: '', blocked_operation: false });

  const [templateForm, setTemplateForm] = useState({ name: '', checklist_type: 'pre_trip' as string });

  const kpis = useMemo(() => ({
    templates: checklists.length,
    executed: executions.length,
    failed: executions.filter(e => e.status === 'failed').length,
    blocked: executions.filter(e => e.blocked_operation).length,
  }), [checklists, executions]);

  const handleCreateTemplate = async () => {
    if (!templateForm.name.trim()) { toast.error('Nome obrigatório'); return; }
    const items = DEFAULT_ITEMS[templateForm.checklist_type] || DEFAULT_ITEMS.pre_trip;
    try {
      await createChecklist.mutateAsync({
        name: templateForm.name,
        checklist_type: templateForm.checklist_type,
        items: items as any,
        active: true,
      });
      setTemplateDialog(false);
      toast.success('Checklist criado');
    } catch (e: any) { toast.error(e.message); }
  };

  const startExecution = (cl: OperationalChecklist) => {
    setSelectedChecklist(cl);
    const items = (cl.items as any[] || []).map((i: any) => ({ key: i.key, label: i.label, status: 'ok' as const }));
    setExecItems(items);
    setExecForm({ vehicle_id: '', employee_id: '', notes: '', blocked_operation: false });
    setExecDialog(true);
  };

  const toggleItem = (idx: number) => {
    setExecItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = item.status === 'ok' ? 'nok' : item.status === 'nok' ? 'na' : 'ok';
      return { ...item, status: next as any };
    }));
  };

  const handleExecute = async () => {
    if (!selectedChecklist) return;
    const failed = execItems.filter(i => i.status === 'nok').length;
    try {
      await createExecution.mutateAsync({
        checklist_id: selectedChecklist.id,
        vehicle_id: execForm.vehicle_id || null,
        employee_id: execForm.employee_id || null,
        checked_items: execItems as any,
        notes: execForm.notes || null,
        blocked_operation: failed > 0,
        execution_type: selectedChecklist.checklist_type,
      });
      setExecDialog(false);
      toast.success(failed > 0 ? `Checklist executado com ${failed} item(ns) reprovado(s)` : 'Checklist aprovado');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Checklists Operacionais</h1>
          <p className="text-sm text-muted-foreground">{checklists.length} templates | {executions.length} execuções</p>
        </div>
        <Button size="sm" onClick={() => { setTemplateForm({ name: '', checklist_type: 'pre_trip' }); setTemplateDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Template
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Templates</p><p className="text-lg font-bold">{kpis.templates}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Executados</p><p className="text-lg font-bold">{kpis.executed}</p></CardContent></Card>
        <Card className={kpis.failed > 0 ? 'border-destructive' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Reprovados</p><p className="text-lg font-bold text-destructive">{kpis.failed}</p></CardContent></Card>
        <Card className={kpis.blocked > 0 ? 'border-warning' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Bloqueios</p><p className="text-lg font-bold text-warning">{kpis.blocked}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="templates">Templates</TabsTrigger><TabsTrigger value="executions">Execuções</TabsTrigger></TabsList>

        <TabsContent value="templates" className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {checklists.map(cl => (
              <Card key={cl.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {cl.name}
                    <Badge variant="outline" className="text-[10px]">{CHECKLIST_TYPE_LABELS[cl.checklist_type] || cl.checklist_type}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">{(cl.items as any[])?.length || 0} itens de verificação</p>
                  <Button size="sm" className="w-full" onClick={() => startExecution(cl)}>
                    <Play className="h-3.5 w-3.5 mr-1" /> Executar
                  </Button>
                </CardContent>
              </Card>
            ))}
            {checklists.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full text-center py-8">Nenhum template de checklist criado</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-3">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Checklist</TableHead><TableHead>Veículo</TableHead>
                <TableHead>Executante</TableHead><TableHead className="text-center">✓</TableHead><TableHead className="text-center">✗</TableHead>
                <TableHead>Status</TableHead><TableHead>Bloqueio</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {executions.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma execução</TableCell></TableRow>
                ) : executions.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{format(parseISO(e.executed_at), 'dd/MM/yy HH:mm')}</TableCell>
                    <TableCell className="text-sm font-medium">{e.operational_checklists?.name || '—'}</TableCell>
                    <TableCell className="text-sm">{e.vehicles?.plate || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.employees?.name || '—'}</TableCell>
                    <TableCell className="text-center text-sm text-success font-medium">{e.passed_items}</TableCell>
                    <TableCell className="text-center text-sm text-destructive font-medium">{e.failed_items}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${e.status === 'passed' ? 'bg-success/10 text-success' : e.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                        {EXECUTION_STATUS_LABELS[e.status] || e.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{e.blocked_operation ? <AlertTriangle className="h-4 w-4 text-warning" /> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Template Dialog */}
      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Template de Checklist</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome *</Label><Input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="Checklist de Saída" /></div>
            <div><Label className="text-xs">Tipo</Label>
              <Select value={templateForm.checklist_type} onValueChange={v => setTemplateForm(f => ({ ...f, checklist_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHECKLIST_TYPES.map(t => <SelectItem key={t} value={t}>{CHECKLIST_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Os itens padrão ({(DEFAULT_ITEMS[templateForm.checklist_type] || DEFAULT_ITEMS.pre_trip).length} itens) serão carregados automaticamente.
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setTemplateDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreateTemplate} disabled={createChecklist.isPending}>Criar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Execution Dialog */}
      <Dialog open={execDialog} onOpenChange={setExecDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Executar: {selectedChecklist?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><Label className="text-xs">Veículo</Label>
              <Select value={execForm.vehicle_id} onValueChange={v => setExecForm(f => ({ ...f, vehicle_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Executante</Label>
              <Select value={execForm.employee_id} onValueChange={v => setExecForm(f => ({ ...f, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            {execItems.map((item, idx) => (
              <div key={item.key} className={`flex items-center gap-3 p-2 rounded border ${item.status === 'nok' ? 'border-destructive/50 bg-destructive/5' : item.status === 'na' ? 'border-muted bg-muted/30' : 'border-success/30 bg-success/5'}`}>
                <button onClick={() => toggleItem(idx)} className="shrink-0">
                  {item.status === 'ok' ? <CheckCircle className="h-5 w-5 text-success" /> : item.status === 'nok' ? <XCircle className="h-5 w-5 text-destructive" /> : <span className="h-5 w-5 rounded-full border-2 border-muted-foreground inline-block text-center text-[10px] leading-[18px]">NA</span>}
                </button>
                <span className="text-sm flex-1">{item.label}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{item.status === 'ok' ? 'OK' : item.status === 'nok' ? 'NOK' : 'N/A'}</span>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={execForm.notes} onChange={e => setExecForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {execItems.some(i => i.status === 'nok') && (
            <div className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30 mt-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <span className="text-xs text-warning">Itens reprovados detectados — operação será bloqueada</span>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setExecDialog(false)}>Cancelar</Button>
            <Button onClick={handleExecute} disabled={createExecution.isPending}>
              {execItems.some(i => i.status === 'nok') ? 'Registrar (com bloqueio)' : 'Aprovar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
