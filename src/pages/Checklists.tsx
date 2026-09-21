import { useState, useMemo } from 'react';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch, matchesDateRange } from '@/lib/listFilters';

import {
  useOperationalChecklists, useCreateChecklist,
  useChecklistExecutions, useCreateChecklistExecution,
  OperationalChecklist,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ClipboardCheck, Play, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { format, parseISO } from 'date-fns';
import { useIsAdmin } from '@/hooks/useTenant';
import { getErrorMessage } from '@/lib/errors';

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
  const toast = useSonnerToast();
  const isAdmin = useIsAdmin();
  const { data: checklists = [], isLoading: loadingTemplates, isError: templatesError, error: templatesErrorDetail, refetch: refetchTemplates } = useOperationalChecklists();
  const { data: executions = [], isLoading: loadingExecutions, isError: executionsError, error: executionsErrorDetail, refetch: refetchExecutions } = useChecklistExecutions();
  const { data: vehicles = [], isLoading: loadingVehicles, isError: vehiclesError, error: vehiclesErrorDetail, refetch: refetchVehicles } = useVehicles();
  const { data: employees = [], isLoading: loadingEmployees, isError: employeesError, error: employeesErrorDetail, refetch: refetchEmployees } = useEmployees();
  const createChecklist = useCreateChecklist();
  const createExecution = useCreateChecklistExecution();

  const [tab, setTab] = useState('templates');
  const templateFilter = useListFilters({ search: '', type: 'all' }, 'template_');
  const executionFilter = useListFilters({ search: '', status: 'all', blocked: 'all', from: '', to: '' }, 'execution_');
  const filteredTemplates = checklists.filter(row => matchesSearch(templateFilter.filters.search, row.name) && (templateFilter.filters.type === 'all' || row.checklist_type === templateFilter.filters.type));
  const ef = executionFilter.filters;
  const filteredExecutions = executions.filter(row => matchesSearch(ef.search, row.operational_checklists?.name, row.vehicles?.plate, row.employees?.name) && (ef.status === 'all' || row.status === ef.status) && (ef.blocked === 'all' || row.blocked_operation === (ef.blocked === 'yes')) && matchesDateRange(row.executed_at, ef.from, ef.to));
  const [templateDialog, setTemplateDialog] = useState(false);
  const [execDialog, setExecDialog] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState<OperationalChecklist | null>(null);
  const [execItems, setExecItems] = useState<{ key: string; label: string; required: boolean; status: 'pending' | 'ok' | 'nok' | 'na'; notes?: string }[]>([]);
  const [execForm, setExecForm] = useState({ vehicle_id: '', employee_id: '', notes: '', blocked_operation: false });

  const [templateForm, setTemplateForm] = useState({ name: '', checklist_type: 'pre_trip' as string });

  const kpis = useMemo(() => ({
    templates: checklists.length,
    executed: executions.length,
    failed: executions.filter(e => e.status === 'failed').length,
    blocked: executions.filter(e => e.blocked_operation).length,
  }), [checklists, executions]);

  const handleCreateTemplate = async () => {
    if (!isAdmin) { toast.error('Apenas administradores podem criar templates.'); return; }
    if (!templateForm.name.trim()) { toast.error('Nome obrigatório'); return; }
    const items = DEFAULT_ITEMS[templateForm.checklist_type] || DEFAULT_ITEMS.pre_trip;
    try {
      await createChecklist.mutateAsync({
        name: templateForm.name.trim(),
        checklist_type: templateForm.checklist_type,
        items,
        active: true,
      });
      setTemplateDialog(false);
      toast.success('Checklist criado');
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : String(error)); }
  };

  const startExecution = (cl: OperationalChecklist) => {
    if (!isAdmin) { toast.error('Apenas administradores podem executar checklists.'); return; }
    if (!cl.active) { toast.error('Este template está inativo e não pode ser executado.'); return; }
    setSelectedChecklist(cl);
    const items = (cl.items || []).map((item) => ({
      key: item.key,
      label: item.label,
      required: item.required,
      status: 'pending' as const,
    }));
    setExecItems(items);
    setExecForm({ vehicle_id: '', employee_id: '', notes: '', blocked_operation: false });
    setExecDialog(true);
  };

  const toggleItem = (idx: number) => {
    setExecItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = item.status === 'pending' ? 'ok' : item.status === 'ok' ? 'nok' : item.status === 'nok' ? 'na' : 'ok';
      return { ...item, status: next };
    }));
  };

  const handleExecute = async () => {
    if (!selectedChecklist || !isAdmin) return;
    if (execItems.some((item) => item.status === 'pending')) {
      toast.error('Confirme todos os itens antes de concluir o checklist.');
      return;
    }
    if (execItems.some((item) => item.required && item.status === 'na')) {
      toast.error('Itens obrigatórios não podem ser marcados como N/A.');
      return;
    }
    const failed = execItems.filter(i => i.status === 'nok').length;
    if (failed > 0 && selectedChecklist.can_generate_maintenance && !execForm.vehicle_id) {
      toast.error('Selecione um veículo para gerar a manutenção dos itens reprovados.');
      return;
    }
    try {
      await createExecution.mutateAsync({
        checklist_id: selectedChecklist.id,
        vehicle_id: execForm.vehicle_id || null,
        employee_id: execForm.employee_id || null,
        checked_items: execItems,
        notes: execForm.notes || null,
        blocked_operation: selectedChecklist.can_block_operation && failed > 0,
        execution_type: selectedChecklist.checklist_type,
      });
      setExecDialog(false);
      toast.success(failed > 0 ? `Checklist executado com ${failed} item(ns) reprovado(s)` : 'Checklist aprovado');
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : String(error)); }
  };

  const sourceError = templatesErrorDetail || executionsErrorDetail || vehiclesErrorDetail || employeesErrorDetail;
  const hasSourceError = templatesError || executionsError || vehiclesError || employeesError;
  const referenceDataLoading = loadingVehicles || loadingEmployees;

  if (hasSourceError) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base text-destructive">Não foi possível carregar os checklists</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{getErrorMessage(sourceError, 'Falha na consulta dos dados necessários.')}</p>
          <Button variant="outline" size="sm" onClick={() => void Promise.all([refetchTemplates(), refetchExecutions(), refetchVehicles(), refetchEmployees()])}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Checklists Operacionais</h1>
          <p className="text-sm text-muted-foreground">{checklists.length} templates | {executions.length} execuções</p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => { setTemplateForm({ name: '', checklist_type: 'pre_trip' }); setTemplateDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Template
        </Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Templates</p><p className="text-lg font-bold">{kpis.templates}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Executados</p><p className="text-lg font-bold">{kpis.executed}</p></CardContent></Card>
        <Card className={kpis.failed > 0 ? 'border-destructive' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Reprovados</p><p className="text-lg font-bold text-destructive">{kpis.failed}</p></CardContent></Card>
        <Card className={kpis.blocked > 0 ? 'border-warning' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Bloqueios</p><p className="text-lg font-bold text-warning">{kpis.blocked}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="templates">Templates</TabsTrigger><TabsTrigger value="executions">Execuções</TabsTrigger></TabsList>

        <TabsContent value="templates" className="mt-3 space-y-3">
          <ListFilterBar fields={[
            { key: 'search', label: 'Buscar modelo', type: 'search', value: templateFilter.filters.search, onChange: value => templateFilter.setFilter('search', value), placeholder: 'Nome do checklist' },
            { key: 'type', label: 'Tipo', value: templateFilter.filters.type, onChange: value => templateFilter.setFilter('type', value), options: [{ value: 'all', label: 'Todos os tipos' }, ...CHECKLIST_TYPES.map(value => ({ value, label: CHECKLIST_TYPE_LABELS[value] }))] },
          ]} onReset={templateFilter.resetFilters} activeCount={templateFilter.activeCount} resultCount={filteredTemplates.length} totalCount={checklists.length} loading={loadingTemplates} description="Os indicadores acima representam todos os registros carregados." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map(cl => (
              <Card key={cl.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {cl.name}
                    <Badge variant="outline" className="text-[10px]">{CHECKLIST_TYPE_LABELS[cl.checklist_type] || cl.checklist_type}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">{cl.items.length} itens de verificação</p>
                  {isAdmin && <Button size="sm" className="w-full" onClick={() => startExecution(cl)} disabled={referenceDataLoading}>
                    <Play className="h-3.5 w-3.5 mr-1" /> Executar
                  </Button>}
                </CardContent>
              </Card>
            ))}
            {filteredTemplates.length === 0 && ( 
              <p className="text-sm text-muted-foreground col-span-full text-center py-8">{loadingTemplates ? 'Carregando modelos...' : 'Nenhum modelo encontrado para os filtros.'}</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-3 space-y-3">
          <ListFilterBar fields={[
            { key: 'search', label: 'Buscar execução', type: 'search', value: ef.search, onChange: value => executionFilter.setFilter('search', value), placeholder: 'Checklist, placa ou executante' },
            { key: 'status', label: 'Resultado', value: ef.status, onChange: value => executionFilter.setFilter('status', value), options: [{ value: 'all', label: 'Todos os resultados' }, ...Object.entries(EXECUTION_STATUS_LABELS).map(([value, label]) => ({ value, label }))] },
            { key: 'blocked', label: 'Bloqueio da operação', value: ef.blocked, onChange: value => executionFilter.setFilter('blocked', value), options: [{ value: 'all', label: 'Todos' }, { value: 'yes', label: 'Com bloqueio' }, { value: 'no', label: 'Sem bloqueio' }] },
            { key: 'from', label: 'Executado de', type: 'date', value: ef.from, max: ef.to || undefined, onChange: value => executionFilter.setFilter('from', value) },
            { key: 'to', label: 'Executado até', type: 'date', value: ef.to, min: ef.from || undefined, onChange: value => executionFilter.setFilter('to', value) },
          ]} onReset={executionFilter.resetFilters} activeCount={executionFilter.activeCount} resultCount={filteredExecutions.length} totalCount={executions.length} loading={loadingExecutions} description="Filtro sobre as execuções carregadas; os indicadores acima são gerais." />
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Checklist</TableHead><TableHead>Veículo</TableHead>
                <TableHead>Executante</TableHead><TableHead className="text-center">✓</TableHead><TableHead className="text-center">✗</TableHead>
                <TableHead>Status</TableHead><TableHead>Bloqueio</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredExecutions.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{loadingExecutions ? 'Carregando execuções...' : 'Nenhuma execução encontrada para os filtros.'}</TableCell></TableRow>
                ) : filteredExecutions.map(e => (
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
          <DialogHeader>
            <DialogTitle>Novo Template de Checklist</DialogTitle>
            <DialogDescription>Crie um modelo com os itens padrão do tipo de checklist selecionado.</DialogDescription>
          </DialogHeader>
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
            <Button onClick={handleCreateTemplate} disabled={createChecklist.isPending || !templateForm.name.trim()}>Criar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Execution Dialog */}
      <Dialog open={execDialog} onOpenChange={setExecDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Executar: {selectedChecklist?.name}</DialogTitle>
            <DialogDescription>Confirme todos os itens e informe os vínculos operacionais antes de concluir o checklist.</DialogDescription>
          </DialogHeader>
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
              <div key={item.key} className={`flex items-center gap-3 p-2 rounded border ${item.status === 'nok' ? 'border-destructive/50 bg-destructive/5' : item.status === 'na' || item.status === 'pending' ? 'border-muted bg-muted/30' : 'border-success/30 bg-success/5'}`}>
                <button onClick={() => toggleItem(idx)} className="shrink-0">
                  {item.status === 'ok' ? <CheckCircle className="h-5 w-5 text-success" /> : item.status === 'nok' ? <XCircle className="h-5 w-5 text-destructive" /> : item.status === 'na' ? <span className="h-5 w-5 rounded-full border-2 border-muted-foreground inline-block text-center text-[10px] leading-[18px]">NA</span> : <span className="h-5 w-5 rounded-full border-2 border-warning inline-block" />}
                </button>
                <span className="text-sm flex-1">{item.label}{item.required ? ' *' : ''}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{item.status === 'ok' ? 'OK' : item.status === 'nok' ? 'NOK' : item.status === 'na' ? 'N/A' : 'Pendente'}</span>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={execForm.notes} onChange={e => setExecForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {selectedChecklist?.can_block_operation && execItems.some(i => i.status === 'nok') && (
            <div className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30 mt-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <span className="text-xs text-warning">Itens reprovados detectados — operação será bloqueada</span>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setExecDialog(false)}>Cancelar</Button>
            <Button onClick={handleExecute} disabled={createExecution.isPending || execItems.some((item) => item.status === 'pending')}>
              {selectedChecklist?.can_block_operation && execItems.some(i => i.status === 'nok') ? 'Registrar (com bloqueio)' : 'Concluir checklist'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
