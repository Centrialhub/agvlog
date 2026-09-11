import {z} from 'zod';
const uuid=z.string().uuid();
export const financeAuditActions:Record<string,string>={recorded:'Registro financeiro',mapped_rows_received:'Importação de extrato',source_checked:'Conferência do original solicitada',identity_reviewed_manually:'Identificação revisada manualmente',identity_review_reversed:'Decisão manual revertida'};
financeAuditActions.payable_movement_applied='Baixa vinculada a uma saída registrada';
financeAuditActions.payable_link_reversed='Vínculo de baixa desfeito manualmente';
financeAuditActions.bank_reconciled_manually='Conciliação bancária manual';
financeAuditActions.bank_reconciled_automatically='Conciliação automática por referência';
financeAuditActions.bank_reconciliation_reversed='Conciliação bancária desfeita manualmente';
financeAuditActions.receivable_movement_recorded='Movimentação vinculada a recebível';
financeAuditActions.receipt_allocation_corrected='Vínculo de recebimento corrigido manualmente';
financeAuditActions.internal_transfer_recorded='Transferência entre contas registrada';
financeAuditActions.transfer_departed='Saída de transferência em trânsito registrada';
financeAuditActions.transfer_arrived='Chegada de transferência registrada';
financeAuditActions.manual_expense_recorded='Despesa avulsa registrada';
financeAuditActions.legacy_expense_cost_associated='Despesa antiga associada manualmente ao custo';
financeAuditActions.legacy_expense_cost_association_reversed='Associação de despesa antiga desfeita manualmente';
financeAuditActions.maintenance_labor_associated='Mão de obra da OS associada manualmente ao custo';
financeAuditActions.maintenance_labor_association_reversed='Associação de mão de obra da OS desfeita manualmente';
financeAuditActions.maintenance_direct_part_associated='Compra direta de peça associada manualmente ao custo';
financeAuditActions.maintenance_direct_part_association_reversed='Associação de compra direta de peça desfeita manualmente';
financeAuditActions.settlement_payment_linked='Pagamento de acerto vinculado manualmente a uma saída';
financeAuditActions.settlement_payment_recorded='Pagamento de acerto registrado';
financeAuditActions.settlement_link_reversed='Vínculo de pagamento de acerto desfeito manualmente';
financeAuditActions.period_evidence_reviewed='Evidências do período revisadas manualmente';
financeAuditActions.account_opening_recorded='Saldo de abertura revisado manualmente';
financeAuditActions.account_opening_reversed='Revisão de saldo de abertura desfeita';
financeAuditActions.cash_opening_recorded='Abertura de caixa por contagem manual';
financeAuditActions.statement_coverage_approved='Cobertura de extrato aprovada pelo usuário';
financeAuditActions.statement_coverage_reversed='Aprovação de cobertura desfeita';
financeAuditActions.legacy_payable_associated='Pagamento antigo associado manualmente à saída';
financeAuditActions.legacy_payable_association_reversed='Associação de pagamento antigo desfeita';
financeAuditActions.legacy_receivable_associated='Recebimento antigo associado manualmente à entrada';
financeAuditActions.legacy_receivable_association_reversed='Associação de recebimento antigo desfeita';
export interface FinanceAuditFilters{page:number;page_size:number;from:string;to:string;action:string;actor_id:string;actor_search:string;search:string;manual_only:boolean}
export const financeAuditSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.number().int().positive(),
  total:z.number().int().nonnegative(),manual_count:z.number().int().nonnegative(),timezone:z.literal('America/Sao_Paulo'),rows:z.array(z.object({
    id:uuid,tenant_id:uuid,entity_type:z.string(),entity_id:uuid,action:z.string(),actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),manual_intervention:z.boolean(),
    decision:z.string().nullable(),row_id:uuid.nullable(),statement_name:z.string().nullable(),source_row:z.number().int().nullable(),
  }))});
financeAuditActions.closed_period_composition_recorded='Detalhamento de valores registrado após fechamento da conta';
financeAuditActions.account_period_closed='Período bancário fechado manualmente';
financeAuditActions.account_period_reopened='Período da conta reaberto manualmente';
financeAuditActions.cash_period_count_recorded='Contagem de caixa registrada manualmente';
financeAuditActions.cash_period_count_reversed='Contagem de caixa desfeita manualmente';
financeAuditActions.cash_period_closed='Período de caixa fechado manualmente';
financeAuditActions.legacy_cut_reviewed='Corte histórico de dinheiro revisado manualmente';
financeAuditActions.stock_consumption_attributed='Consumo de estoque atribuído manualmente às aquisições';
financeAuditActions.stock_consumption_attribution_reversed='Atribuição de consumo às aquisições desfeita manualmente';
financeAuditActions.stock_acquisition_associated='Aquisição de estoque associada manualmente ao custo';
financeAuditActions.stock_acquisition_association_reversed='Associação de aquisição de estoque desfeita manualmente';
financeAuditActions.expense_cancelled='Gasto cancelado manualmente, com original preservado';
financeAuditActions.manual_expense_cancelled='Despesa avulsa cancelada manualmente, com original preservado';
financeAuditActions.movement_voided='Movimentação invalidada manualmente, com original preservado';
financeAuditActions.unloading_projection_repaired='Título de descarga restaurado manualmente conforme a origem';

financeAuditActions.unloading_origin_corrected='Fornecedor ou cobrança de descarga corrigidos manualmente';
financeAuditActions.unloading_cancelled_coordinated='Descarga e custo cancelados com histórico preservado';
financeAuditActions.unloading_cost_corrected='Custo de descarga corrigido manualmente';
financeAuditActions.unloading_cost_regularized='Custo coberto regularizado manualmente';
financeAuditActions.cost_disposition_return_recorded='Devolução vinculada à responsabilidade financeira';
financeAuditActions.unloading_open_complement_corrected='Complemento de descarga corrigido manualmente';
financeAuditActions.payable_approved_with_revision='Conta aprovada após conferência de valor';
financeAuditActions.cash_forecast_preserved='Previsão de caixa preservada pelo responsável';
financeAuditActions.unloading_open_complement_extinguished='Complemento cancelado após correção do custo';

financeAuditActions.cash_forecast_agenda_set='Data esperada da previsão revisada';
financeAuditActions.cash_forecast_agenda_cleared='Data manual da previsão retirada';
