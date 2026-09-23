import {useEmployeeAdvanceRegistration} from './useEmployeeAdvanceRegistration';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import {readPayrollProjection,readPayrollPeriodPage,readPayrollPeriods} from '@/lib/financial/ledgerClient';
import type {PayrollPaymentSummary} from '@/lib/financial/payrollPaymentContract';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';
import {acknowledgeDurableOperatorCommand,isDefinitiveOperatorCommandRejection,prepareDurableOperatorCommand,readDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';

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

export function usePayrollEntries(periodId?: string,page=1,search='',payment='all',entryId:string|null=null) {
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey: ['payroll_entries', periodId,currentTenant?.id,page,search,payment,entryId],
    queryFn: async () => {
      if (!periodId||!currentTenant) return null;
      return await readPayrollProjection(currentTenant.id,periodId,page,search,payment,entryId) as unknown as {rows:(PayrollEntry & { employees?: { name: string|null; doc_cpf: string | null; branch: string | null; department: string | null } })[];total:number;filtered_total:number;has_more:boolean;totals:{gross:string;discount:string;already_paid:string;carryover_in:string;carryover_out:string;title_paid:string;remaining:string}};
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
      qc.invalidateQueries({ queryKey: ['payroll_generation_issues'] });
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
  const {currentTenant}=useTenant();const {user}=useAuth();const [,setPendingRevision]=useState(0);
  const reconcile=()=>Promise.all([qc.invalidateQueries({queryKey:['payroll_periods']}),qc.invalidateQueries({queryKey:['payroll_entries']}),qc.invalidateQueries({queryKey:['payroll_generation_issues']}),qc.invalidateQueries({queryKey:['payables']}),qc.invalidateQueries({queryKey:['finance-recorded-costs']}),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
  const mutation=useMutation({
    mutationFn: async (period_id: string) => {
      if(!currentTenant||!user)throw new Error('Sessão não disponível.');
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'approve_payroll_period',entityId:period_id,payload:{period_id}});
      let data;
      try{const response=await (supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message:string}|null}>)('approve_payroll_period_v3',{_period_id:period_id,_request_id:pending.requestId});if(response.error)throw response.error;data=response.data;}
      catch(error){if(isDefinitiveOperatorCommandRejection(error))acknowledgeDurableOperatorCommand(pending);await reconcile();setPendingRevision(value=>value+1);throw error;}
      const result = data as { approved?: boolean; issue_count?: number } | null;
      acknowledgeDurableOperatorCommand(pending);setPendingRevision(value=>value+1);
      if (!result?.approved) {
        await qc.invalidateQueries({ queryKey: ['payroll_generation_issues'] });
        throw new Error(`${result?.issue_count || 0} pendência(s) impedem a aprovação. Corrija e recalcule a folha.`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_periods'] });
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
      qc.invalidateQueries({ queryKey: ['payroll_generation_issues'] });
      Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
  });
  return mutation;
}

export function useClosePayrollPeriod() {
  const qc = useQueryClient();
  const {currentTenant}=useTenant();const {user}=useAuth();
  return useMutation({
    mutationFn: async ({ period_id, reason }: { period_id: string; reason?: string }) => {
      if(!currentTenant||!user)throw new Error('Sessão não disponível.');
      const payload={period_id,reason:reason?.trim()??''};
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'close_payroll_period',entityId:period_id,payload});
      try{const {error}=await (supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{error:{code?:string;message:string}|null}>)('close_payroll_period_v2',{_period_id:period_id,_reason:reason??null,_request_id:pending.requestId});if(error)throw error;acknowledgeDurableOperatorCommand(pending);}
      catch(error){if(isDefinitiveOperatorCommandRejection(error))acknowledgeDurableOperatorCommand(pending);await Promise.all([qc.invalidateQueries({queryKey:['payroll_periods']}),qc.invalidateQueries({queryKey:['payables']}),qc.invalidateQueries({queryKey:['finance-recorded-costs']}),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]);throw error;}
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payroll_periods'] }); void Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]); },
  });
}

export function usePayrollGenerationIssues(periodId?:string){
 const {currentTenant}=useTenant();return useQuery({queryKey:['payroll_generation_issues',currentTenant?.id,periodId],enabled:!!currentTenant&&!!periodId,queryFn:async()=>{
  if(!currentTenant||!periodId)return [];return await fetchAllPostgrestPages((from,to)=>supabase.from('payroll_generation_issues').select('*').eq('tenant_id',currentTenant.id).eq('payroll_period_id',periodId).eq('resolved',false).order('created_at').order('id').range(from,to));
 }});
}
export function useChangePayrollPeriodState(){const qc=useQueryClient();const {currentTenant}=useTenant();const {user}=useAuth();const [,setPendingRevision]=useState(0);const mutation=useMutation({mutationFn:async(input:{periodId:string;action:'cancel'|'reopen';reason:string})=>{
 if(input.reason.trim().length<5)throw new Error('Informe um motivo com pelo menos 5 caracteres.');if(!currentTenant||!user)throw new Error('Sessão não disponível.');
 const command={period_id:input.periodId,action:input.action,reason:input.reason.trim()};const pending=await prepareDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'change_payroll_period_state',entityId:input.periodId,payload:command});
 try{const {error}=await (supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{error:{message:string;code?:string}|null}>)('change_payroll_period_state_v2',{_period_id:input.periodId,_action:input.action,_reason:input.reason.trim(),_request_id:pending.requestId});if(error)throw error;acknowledgeDurableOperatorCommand(pending);setPendingRevision(value=>value+1);}catch(error){if(isDefinitiveOperatorCommandRejection(error))acknowledgeDurableOperatorCommand(pending);setPendingRevision(value=>value+1);throw error;}
 },onSuccess:()=>{qc.invalidateQueries({queryKey:['payroll_periods']});qc.invalidateQueries({queryKey:['payroll_entries']});qc.invalidateQueries({queryKey:['payroll_generation_issues']});qc.invalidateQueries({queryKey:['payables']});}});return Object.assign(mutation,{
  getPendingCommand:(periodId:string)=>currentTenant&&user?readDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'change_payroll_period_state',entityId:periodId}):null,
  recoverPending:(periodId:string)=>{const pending=currentTenant&&user?readDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'change_payroll_period_state',entityId:periodId}):null;const saved=pending?.payload as {period_id?:string;action?:'cancel'|'reopen';reason?:string}|undefined;return saved?.period_id&&saved.action&&saved.reason?mutation.mutateAsync({periodId:saved.period_id,action:saved.action,reason:saved.reason}):Promise.reject(new Error('Nenhuma alteração pendente.'));},
  discardPending:(periodId:string)=>{const pending=currentTenant&&user?readDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'change_payroll_period_state',entityId:periodId}):null;if(pending)acknowledgeDurableOperatorCommand(pending);setPendingRevision(value=>value+1);},
 });}

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
  const [,setPendingRevision]=useState(0);
  const mutation=useMutation({
    mutationFn: async (values: CreateEmployeeContractInput) => {
      if(!user)throw new Error('Usuário não autenticado');
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant!.id,actorId:user.id,action:'create_employee_contract',entityId:'new',payload:values});
      let data;
      try{const result = await supabase.rpc('create_employee_contract_v1', {
        _payload: { ...values, tenant_id: currentTenant!.id,request_id:pending.requestId } as unknown as Json,
      });if(result.error)throw result.error;data=result.data;}catch(error){if(isDefinitiveOperatorCommandRejection(error))acknowledgeDurableOperatorCommand(pending);setPendingRevision(value=>value+1);throw error;}
      acknowledgeDurableOperatorCommand(pending);
      setPendingRevision(value=>value+1);
      return data as unknown as EmployeeContract;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['employee_contracts', v.employee_id] }),
  });
  const pendingCommand=currentTenant&&user?readDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'create_employee_contract',entityId:'new'}):null;
  return Object.assign(mutation,{
    pendingCommand,
    recoverPending:()=>pendingCommand?mutation.mutateAsync(pendingCommand.payload as CreateEmployeeContractInput):Promise.reject(new Error('Nenhum contrato pendente.')),
    discardPending:()=>{if(pendingCommand)acknowledgeDurableOperatorCommand(pendingCommand);setPendingRevision(value=>value+1);},
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
