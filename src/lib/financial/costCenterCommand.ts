import {z} from 'zod';

const id=z.string().uuid();
const costCenterSchema=z.object({
  id,
  tenant_id:id,
  name:z.string().min(1).max(200),
  active:z.boolean(),
  created_at:z.string(),
  updated_at:z.string(),
}).strict();

const resultSchema=z.object({
  version:z.literal(1),
  tenant_id:id,
  actor_id:id,
  status:z.enum(['created','reactivated','already_active']),
  confirmed:z.literal(true),
  cost_center:costCenterSchema,
}).strict();

export type CostCenterSaveResult=z.infer<typeof resultSchema>;

export class CostCenterAlreadyActiveError extends Error {
  constructor(){super('Já existe um centro de custo ativo com esse nome.');this.name='CostCenterAlreadyActiveError';}
}

export function parseCostCenterSaveResult(value:unknown,tenantId:string):CostCenterSaveResult{
  const parsed=resultSchema.safeParse(value);
  if(!parsed.success||parsed.data.tenant_id!==tenantId||parsed.data.cost_center.tenant_id!==tenantId){
    throw new Error('Confirmação de centro de custo incompatível com a empresa ativa. Atualize a página.');
  }
  return parsed.data;
}

export function costCenterCommandError(cause:unknown){
  const message=cause instanceof Error?cause.message:typeof cause==='object'&&cause&&'message' in cause?String(cause.message):'';
  if(cause instanceof CostCenterAlreadyActiveError||/23505|duplicate/i.test(message))return 'Já existe um centro de custo ativo com esse nome.';
  if(/invalid_name/.test(message))return 'Informe um nome de centro de custo com até 200 caracteres.';
  if(/not_authorized|permission denied/.test(message))return 'Sua sessão não tem permissão para gerenciar centros de custo nesta empresa.';
  return message||'Não foi possível salvar o centro de custo.';
}

export function costCenterDeleteError(cause:unknown){
  const code=typeof cause==='object'&&cause&&'code' in cause?String(cause.code):'';
  if(code==='23001'||code==='23503'){
    return 'Este centro de custo já está vinculado a despesas. Desative-o para preservar o histórico.';
  }
  const message=cause instanceof Error?cause.message:typeof cause==='object'&&cause&&'message' in cause?String(cause.message):'';
  return 'Erro ao excluir centro de custo: '+(message||'não foi possível concluir a exclusão.');
}
