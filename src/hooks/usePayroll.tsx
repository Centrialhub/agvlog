import {useEmployeeAdvanceRegistration} from './useEmployeeAdvanceRegistration';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import {readPayrollProjection,readPayrollPeriodPage,readPayrollPeriods} from '@/lib/financial/ledgerClient';
import type {PayrollPaymentSummary} from '@/lib/financial/payrollPaymentContract';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';
import {acknowledgeDurableOperatorCommand,prepareDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';

// ---------------- Constants / labels ----------------
export const PAYROLL_PERIOD_STATUSES = ['draft','calculated','under_review','approved','closed','cancelled'] as const;
export type PayrollPeriodStatus = typeof PAYROLL_PERIOD_STATUSES[number];
export const PAYROLL_PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus,string> = {
  draft: 'Rascunho', calculated: 'Calculada', under_review: 'Em revisão',
  approved: 'Aprovada', closed: 'Fechada', cancelled: 'Cancelada',
};
export const PAYROLL_PAYMENT_STATUS_LABELS: Record<string,string> = {
  unpaid: 'Não paga', partial: 'Parcial', paid: 'Paga',review:'Conferir',cancelled:'Cancelada',
};

export const PAYROLL_ITEM_TYPE_LABELS: Record<string,string> = {
  base_salary: 'Salário base', daily: 'Diária', hourly: 'Hora', commission: 'Comissão',
  bonus: 'Bônus', allowance: 'Ajuda de custo',
  driver_settlement: 'Acerto motorista', driver_settlement_payment: 'Pagto acerto',
  driver_expense_reimbursement: 'Reembolso despesa', driver_advance: 'Adiantamento',
  expense_paid_by_company: 'Despesa paga p/ empresa', incident_discount: 'Desconto ocorrência',
  manual_credit: 'Crédito manual', manual_debit: 'Débito manual', other: 'Outro',
};

export const CONTRACT_TYPES = ['employee','driver','contractor','temporary','intern','third_party','other'] as const;
export const CONTRACT_TYPE_LABELS: Record<string,string> = {
  employee: 'Funcionário', driver: 'Motorista', contractor: 'Prestador',
  temporary: 'Temporário', intern: 'Estagiário', third_party: 'Terceiro', other: 'Outro',
};
export const EMPLOYMENT_REGIMES = ['clt','pj','autonomous','daily','commission','other'] as const;
export const EMPLOYMENT_REGIME_LABELS: Record<string,string> = {
  clt: 'CLT', pj: 'PJ', autonomous: 'Autônomo', daily: 'Diarista', commission: 'Comissionado', other: 'Outro',
};
export const PAYMENT_CYCLES = ['weekly','biweekly','monthly','per_trip','custom'] as const;
export const PAYMENT_CYCLE_LABELS: Record<string,string> = {
  weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal', per_trip: 'Por viagem', custom: 'Custom',
};

export const ADVANCE_STATUSES = ['pending','approved','paid','cancelled'] as const;
export const ADVANCE_STATUS_LABELS: Record<string,string> = {
  pending: 'Pendente', approved: 'Aprovado', paid: 'Pago', cancelled: 'Cancelado',
};

// ---------------- Types ----------------
export type PayrollPeriod = Omit<Tables<'payroll_periods'>, 'status'> & { status: PayrollPeriodStatus };
export type PayrollEntry = Tables<'payroll_entries'> & {payment_summary?:PayrollPaymentSummary};
export type PayrollEntryItem = Omit<Tables<'payroll_entry_items'>, 'nature'> & {
  nature: 'credit' | 'debit' | 'already_paid' | 'info';
};
export type EmployeeContract = Tables<'employee_contracts'>;
export type EmployeeAdvance = Tables<'employee_advances'>;
export type CreateEmployeeContractInput = Omit<TablesInsert<'employee_contracts'>, 'tenant_id' | 'created_by'>;
export type UpdateEmployeeContractInput = TablesUpdate<'employee_contracts'> & { id: string };

// ---------------- Payroll Periods ----------------
export function usePayrollPeriods(page=1,filters={search:'',status:'all',payment:'all'},paging={snapshotAt:'',collectionRevision:''}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['payroll_periods', currentTenant?.id,page,filters,paging],
    queryFn: async () => {
      if (!currentTenant) return {rows:[] as PayrollPeriod[],total:0,snapshot_at:'',collection_revision:''};
      const result=await readPayrollPeriodPage(currentTenant.id,page,30,{...filters,snapshot_at:paging.snapshotAt,collection_revision:paging.collectionRevision});return {rows:result.rows as unknown as PayrollPeriod[],total:result.total,snapshot_at:result.snapshot_at,collection_revision:result.collection_revision};
    },
    enabled: !!currentTenant,
    refetchOnWindowFocus:true,
    staleTime:60000,
  });
}

export function usePayrollPeriod(id?: string) {
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey: ['payroll_period', id,currentTenant?.id],
    queryFn: async () => {
      if (!id||!currentTenant) return null;
      return (await readPayrollPeriods(currentTenant.id,id))[0] as unknown as PayrollPeriod | null ?? null;
    },
    enabled: !!id&&!!currentTenant,
  });
}

export function usePayrollEntries(periodId?: string) {
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey: ['payroll_entries', periodId,currentTenant?.id],
    queryFn: async () => {
      if (!periodId||!currentTenant) return [];
      return await readPayrollProjection(currentTenant.id,periodId) as unknown as (PayrollEntry & { employees?: { name: string|null; doc_cpf: string | null; branch: string | null; department: string | null } })[];
    },
    enabled: !!periodId&&!!currentTenant,
    refetchOnWindowFocus:true,
    refetchInterval:30000,
  });
}

export function usePayrollEntryItems(entryId?: string) {
  return useQuery({
    queryKey: ['payroll_entry_items', entryId],
    queryFn: async () => {
      if (!entryId) return [];
      return await fetchAllPostgrestPages((from,to)=>supabase.from('payroll_entry_items').select('*')
        .eq('payroll_entry_id', entryId).order('nature').order('created_at').order('id').range(from,to)) as unknown as PayrollEntryItem[];
    },
    enabled: !!entryId,
  });
}

export function useGeneratePayrollPeriod() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { period_start: string; period_end: string; period_name?: string; include_drivers?: boolean; include_non_drivers?: boolean }) => {
      const { data, error } = await supabase.rpc('generate_payroll_period', {
        _tenant_id: currentTenant!.id,
        _period_start: args.period_start,
        _period_end: args.period_end,
        _period_name: args.period_name ?? undefined,
        _include_drivers: args.include_drivers ?? true,
        _include_non_drivers: args.include_non_drivers ?? true,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_periods'] });
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
    },
  });
}

export function useRecalculatePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry_id: string) => {
      const { error } = await supabase.rpc('recalculate_payroll_entry', { _entry_id: entry_id });
      if (error) throw error;
    },
    onSuccess: (_d, entry_id) => {
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
      qc.invalidateQueries({ queryKey: ['payroll_entry_items', entry_id] });
    },
  });
}

export function useApprovePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period_id: string) => {
      const { error } = await supabase.rpc('approve_payroll_period', { _period_id: period_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_periods'] });
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
  });
}

export function useClosePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ period_id, reason }: { period_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('close_payroll_period', { _period_id: period_id, _reason: reason ?? undefined });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payroll_periods'] }); void Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]); },
  });
}

export function usePayrollGenerationIssues(periodId?:string){
 const {currentTenant}=useTenant();return useQuery({queryKey:['payroll_generation_issues',currentTenant?.id,periodId],enabled:!!currentTenant&&!!periodId,queryFn:async()=>{
  if(!currentTenant||!periodId)return [];return await fetchAllPostgrestPages((from,to)=>supabase.from('payroll_generation_issues').select('*').eq('tenant_id',currentTenant.id).eq('payroll_period_id',periodId).eq('resolved',false).order('created_at').order('id').range(from,to));
 }});
}
export function useChangePayrollPeriodState(){const qc=useQueryClient();const {currentTenant}=useTenant();const {user}=useAuth();return useMutation({mutationFn:async(input:{periodId:string;action:'cancel'|'reopen';reason:string})=>{
 if(input.reason.trim().length<5)throw new Error('Informe um motivo com pelo menos 5 caracteres.');if(!currentTenant||!user)throw new Error('Sessão não disponível.');
 const command={period_id:input.periodId,action:input.action,reason:input.reason.trim()};const pending=await prepareDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'change_payroll_period_state',entityId:input.periodId,payload:command});
 const {error}=await (supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{error:{message:string}|null}>)('change_payroll_period_state_v2',{_period_id:input.periodId,_action:input.action,_reason:input.reason.trim(),_request_id:pending.requestId});if(error)throw new Error(error.message);acknowledgeDurableOperatorCommand(pending);
 },onSuccess:()=>{qc.invalidateQueries({queryKey:['payroll_periods']});qc.invalidateQueries({queryKey:['payroll_entries']});qc.invalidateQueries({queryKey:['payroll_generation_issues']});qc.invalidateQueries({queryKey:['payables']});}});}

// ---------------- Manual item ops ----------------
export function useAddPayrollManualItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { entry: PayrollEntry; nature: 'credit'|'debit'; description: string; amount: number; reason: string }) => {
      if (!args.reason || !args.reason.trim()) throw new Error('Motivo obrigatório para ajuste manual');
      const { data, error } = await supabase.rpc('add_payroll_manual_item', {
        _entry_id: args.entry.id,
        _nature: args.nature,
        _description: args.description,
        _amount: args.amount,
        _reason: args.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
      qc.invalidateQueries({ queryKey: ['payroll_entry_items', args.entry.id] });
    },
  });
}

export function useDeletePayrollItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { item: PayrollEntryItem; reason: string }) => {
      if (!args.reason || !args.reason.trim()) throw new Error('Motivo obrigatório para exclusão');
      const { error } = await supabase.rpc('delete_payroll_entry_item', {
        _item_id: args.item.id,
        _reason: args.reason,
      });
      if (error) throw error;
      return args.item;
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
      qc.invalidateQueries({ queryKey: ['payroll_entry_items', item.payroll_entry_id] });
    },
  });
}

// ---------------- Employee contracts ----------------
export function useEmployeeContracts(employeeId?: string) {
  return useQuery({
    queryKey: ['employee_contracts', employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const { data, error } = await supabase.from('employee_contracts').select('*')
        .eq('employee_id', employeeId)
        .order('active', { ascending: false })
        .order('start_date', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as EmployeeContract[];
    },
    enabled: !!employeeId,
  });
}

export function useCreateEmployeeContract() {
  const { currentTenant } = useTenant();
  const {user}=useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateEmployeeContractInput) => {
      if(!user)throw new Error('Usuário não autenticado');
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant!.id,actorId:user.id,action:'create_employee_contract',entityId:'new',payload:values});
      const { data, error } = await supabase.rpc('create_employee_contract_v1', {
        _payload: { ...values, tenant_id: currentTenant!.id,request_id:pending.requestId } as unknown as Json,
      });
      if (error) throw error;
      acknowledgeDurableOperatorCommand(pending);
      return data as unknown as EmployeeContract;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['employee_contracts', v.employee_id] }),
  });
}

export function useUpdateEmployeeContract() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateEmployeeContractInput) => {
      const { data, error } = await supabase.from('employee_contracts')
        .update({ ...values, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data as EmployeeContract;
    },
    onSuccess: (contract) => qc.invalidateQueries({ queryKey: ['employee_contracts', contract.employee_id] }),
  });
}

// ---------------- Employee advances ----------------
export function useEmployeeAdvances(filters?: { employeeId?: string; status?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['employee_advances', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      const rows:(EmployeeAdvance & {employees?:{name:string}})[]=[];
      for(let from=0;;from+=1000){let q=supabase.from('employee_advances').select('*, employees(name)').eq('tenant_id',currentTenant.id);if(filters?.employeeId)q=q.eq('employee_id',filters.employeeId);if(filters?.status)q=q.eq('status',filters.status);const {data,error}=await q.order('advance_date',{ascending:false}).order('id').range(from,from+999);if(error)throw error;rows.push(...((data||[]) as unknown as typeof rows));if(!data||data.length<1000)break;}return rows;
    },
    enabled: !!currentTenant,
  });
}

export function useRegisterEmployeeAdvance() {return useEmployeeAdvanceRegistration();}

// ---------------- Employee incident actions ----------------
export function useEmployeeIncidentActions(employeeId?: string) {
  return useQuery({
    queryKey: ['employee_incident_actions', employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const { data, error } = await supabase.from('employee_incident_actions').select('*, incidents(title, status, occurred_at)')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!employeeId,
  });
}
