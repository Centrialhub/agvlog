import {unloadingCancellationLabels} from './unloadingCancellationLabels';
export const unloadingCostCorrectionLabels:Record<string,string>={
 ...unloadingCancellationLabels,
 finance_expense_money_dependency:'Este custo possui vínculos com dinheiro registrado e exige regularização antes da correção. Confira os pagamentos e envios relacionados.',
 finance_expense_cost_unverified:'O valor vigente do custo não foi comprovado. Confira o histórico antes de corrigir.',
 finance_expense_cost_chain_invalid:'O histórico de alterações do custo está inconsistente e precisa de conferência.',
 finance_unloading_cost_unchanged:'O valor proposto é igual ao custo vigente.',
 finance_unloading_cost_source_unavailable:'Não foi possível identificar o custo e sua única obrigação nesta descarga.',
 finance_unloading_cost_payable_mismatch:'A obrigação diverge do custo vigente e exige regularização.',
 finance_unloading_cost_overallocated:'Os valores já vinculados excedem o custo proposto. Confira os vínculos.',
 finance_unloading_cost_blocked:'Há impedimentos à correção. Confira os vínculos apresentados.',
 finance_unloading_cost_changed:'Os dados mudaram. Confira novamente antes de iniciar outro pedido; preserve qualquer pedido pendente.',
 finance_unloading_cost_busy:'Outra operação está usando esta descarga. Preserve e recupere o mesmo pedido pendente.',
 finance_unloading_cost_ticket_required:'A autorização desta correção não pôde ser comprovada. Atualize a conferência.',
 finance_unloading_cost_ticket_unconsumed:'A correção não foi concluída de forma consistente. Confira novamente e preserve o pedido pendente.',
 finance_invalid_amount:'Informe um valor positivo válido para o custo.',
 finance_invalid_payload:'O pedido de correção está incompleto ou inconsistente.',
 finance_request_conflict:'O identificador deste pedido já foi usado com outros dados. Preserve o pedido original.',
};
export function unloadingCostCorrectionErrorLabel(error:unknown){const message=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';return unloadingCostCorrectionLabels[message]||message||'O pedido não foi confirmado. Preserve e recupere o pedido pendente, se houver.';}
