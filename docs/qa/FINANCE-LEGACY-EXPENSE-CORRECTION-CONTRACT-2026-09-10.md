# Retificação auditada de despesa legada protegida

Proposta para revisão, somente leitura; nenhuma migration congelada alterada. Não liberar UPDATE/DELETE de driver_expenses, inclusive após reversão de associação.

## Evidência e fronteira

- 55442:24–53 associa somente approved, empresa/não reembolsável, viagem/motorista coerentes e alvo canônico de mesmo valor/data/categoria. 55442:127–138 mantém driver_expenses no acerto, exclui o item canônico associado da composição e protege a linha original permanentemente.
- create_driver_expense_command211707 cria uma origem nova. review_driver_expense211707 altera aprovação com revisão/auditoria; não é comando de retificação. _tg_mark_outdated_expense marca acertos. Replicar despesa para corrigir montante geraria outra origem, podendo repetir composição e obrigação.
- useExpenseCreation/useExpenseReview usam comandos recuperáveis e revisão de contexto. Não existe UI/comando de retificação de fonte protegida; a recusa atual é uma pendência real, não razão para contornar trigger.
- Acerto/folha usam source_table/source_id e snapshots de cobertura. 132406 deduplica reembolso por IDs; trocar o ID da despesa destruiria essa identidade. Folhas/acertos protegidos não devem ser recalculados silenciosamente.
- finance_unloading_charges212514 identifica delivery_stop_id e resolve fornecedor pelas NFs. O recebível de descarga tem identidade própria; despesa operacional e cobrança ao fornecedor não são o mesmo lançamento.

## Menor fluxo completo implementável

**Retificar a representação legada em relação a um custo canônico correto já existente**, mantendo root_expense_id. Não criar outro driver_expenses, custo, título, recebível ou movimento. A primeira fatia cobre despesas da empresa/não reembolsáveis, contexto viagem/motorista preservado, categoria diferente de unloading. Essa é exatamente a família já associável em55442.

Exemplo legítimo: despesa legada de R$50 foi associada por engano ao custo A de R$50; a nota correta corresponde ao custo B de R$60 já registrado. Desfazer a associação errada e retificar a representação legada para B conserva A e B como custos distintos já existentes; só a composição da viagem deixa de representar B duas vezes. O operador precisa confirmar explicitamente que A permanece outro fato legítimo. Se A e B são duplicatas do mesmo gasto, bloquear esse fluxo: retirar ou compensar custo/dever incorreto é outro comando.

**Quando o próprio custo canônico está errado**, retificação legada sozinha é insuficiente. Será necessário comando de substituição/compensação de custo com título, parcelas e pagamentos por IDs. Não aumentar driver_expense e deixar payable divergente; não cancelar título pago para “consertar KPI”. Essa segunda família fica pendência explícita com motivo e IDs, não falsa correção concluída.

## Representação e comandos

Tabela append-only `finance_legacy_expense_rectifications`: id,tenant_id,root_expense_id,previous_rectification_id,canonical_cost_id,revision,before_snapshot,after_snapshot,reason,actor_id/name,request_id,created_at. Preservar original completa, associação/reversões antigas, alvo/lote/obrigações/payables/payments/allocations, acertos, folhas e seus IDs de cobertura. Uma cabeça vigente por origem, mantida em registro privado protegido. Nada substitui fisicamente a linha histórica.

`preview_finance_legacy_expense_rectification(tenant,expense,target_cost)` retorna original, visão efetiva atual, proposta derivada do custo escolhido, histórico, diferença de custo/composição/saldo, contas e cortes afetados, blockers e revisão combinada. A proposta inclui amount/category/expense_date/descrição e referência de evidência; driver/trip/payment_source/reimbursable/advance identity ficam fixos na primeira versão. Motivo e recibo novo são evidências adicionais, não substituição do arquivo antigo.

`rectify_finance_legacy_expense(_payload)` estrito: version,tenant_id,request_id,expense_id,target_cost_id,revision,reason,source_representation_confirmed=true,previous_cost_is_distinct_confirmed quando houver associação anterior. Não aceitar amount livre quando o alvo fornece o valor. Comando valida proposta novamente, grava evento, reverte associação antiga quando ativa por evento próprio e instala ponte explícita da nova versão com o alvo em transação única. Associação vigente passa a referenciar rectification_id e root_expense_id, sem apagar55442.

Resultado: rectification_id,root_expense_id,previous_rectification_id,target_cost_id,effective_amount_cents,composition_delta_cents,driver_balance_delta_cents,cash_changed=false,cost_created=false,obligation_created=false,receivable_created=false,confirmed=true. Para company/nonreimb, driver_balance_delta_cents deve ser0; custo da composição muda por diferença, dinheiro enviado e salário não mudam.

Reversão/correção da retificação deve ser novo evento apontando a versão anterior e restabelecendo ponte coerente, com revisão atual e mesmas proteções. Não apagar eventos nem UPDATE da linha legada. Se a versão anterior já não for compatível com o alvo/obrigações atuais, bloquear com diagnóstico em vez de restaurar estado inconsistente.

## Consumidores que precisam mudar juntos

Criar resolvedor `effective_legacy_expense(tenant,root_expense_id)` que retorna os campos efetivos e IDs originais/versão. Integrar primeiro todos os escritores/consumidores capazes de calcular dinheiro: _build_driver_settlement, _build_manual_driver_settlement, snapshot/contexto de review, inventário/opções55442, detalhes operacionais e fonte de obrigação legada. Não basta trocar a lista frontend.

Builders continuam source_table='driver_expenses', source_id=root_expense_id, acrescentando rectification_id e snapshot original/efetivo. Exclusão do item canônico usa ponte vigente porID. Mesmo item não pode pertencer simultaneamente à associação antiga e à retificação, nem ser alvo de outra origem incompatível. Fonte global recorded_costs permanece canônica e não soma retificação como linha adicional.

Folha de remuneração/reembolso continua por seus IDs originais. Primeira versão não muda obrigação de reembolso; não gera already_paid nem remuneração. Marcar apenas acertos editáveis como needs_recalculation e reconstruir por comando existente antes de nova aprovação. Não recalcular folhas manuais, approved/closed ou canceladas com pagamento real. Se a retificação altera algum item efetivo de folha, exige fluxo de revisão próprio antes de confirmar.

Obrigações financeiras legadas ligadas à origem precisam ser classificadas: se existir payable diferente do alvo, pagamento, match ou transferência do direito, bloquear. A simples existência de financial_obligations não autoriza editar o seu valor sem snapshot/evento. A primeira versão pode exigir ausência de materialização conflitante e atualizar somente projeção de obrigação derivada por comando interno auditado, preservando ID e sem novo título.

## Motorista, descarga e períodos

Mudar payment_source, reimbursable, paid_with_advance, beneficiário, motorista ou viagem altera quem deve a quem: não é retificação da primeira versão. Para essa segunda família, preview deve demonstrar saldo anterior/novo por fonte e abater pagamentos reais existentes, retornos e créditos da folha. Nunca converter reembolso em salário nem ignorar dinheiro já enviado. A solução completa exigirá evento de ajuste de obrigação do motorista e política de sobrepagamento/crédito, preservando IDs da origem.

Descarga exige resolver delivery_stop_id original, fornecedor único pelas NFs, charge/receivable/canonical_cost por IDs. Retificar amount do gasto não pode invocar record_unloading e criar cobrança nova. Ajustar recebível existente exige a própria máquina de eventos/recebimentos/devoluções; se já recebido, diferença vira crédito/devolução/obrigação de cobrança explícita conforme política, sem dinheiro fictício. Bloquear descarga nesta primeira fatia é obrigatório até esse caminho atômico existir.

Preview enumera acertos/folhas protegidos e fechamentos ligados aos movimentos/payments/allocations/obrigações afetados, além de snapshots de composição que referenciem a origem. Correção não pode passar sobre esses impedimentos: reabrir o domínio afetado por seu comando auditado antes. Sem conta/data determináveis para impacto monetário, não assumir que está fora do fechamento. Diferenciar bloqueio do acerto/folha de divergência bancária: retificação de composição não altera nem desconcilia extrato. A política de exigir reabertura bancária quando somente uma composição informativa antiga muda deve ser explícita no preview, não inferida de data da despesa; snapshots bancários antigos permanecem imutáveis.

## Segurança e testes

can_access financeiro, motorista/misto excluídos. Locks finance → períodos → viagem/acertos → entries → fonte/custo/títulos, IDs ordenados; escritores com row lock usam try/nowait para não inverter. Reautorizar após espera; revisão inclui relações/versões/recibos, não só valor. Outbox recuperável e replay por ator/payload. Auditoria global manual permanente com ator/tempo/motivo; UI exibe Original/Retificação atual/Impacto/Impedimentos antes de confirmar.

Aceitação mínima da primeira fatia: original50→representação60 vinculada a custo B sem custo/pagamento extra; tentativa de usar alvo A+B duplicados bloqueada; associação antiga revertida preservada; _build_driver_settlement mantém um rootID e custo único; diferença de saldo motorista0 no casoempresa; retry e duasretificações disputadas; fonte/target alterado durante espera; negação de edição/deleção após reversão; acerto/folha protegidos e fechamento afetado bloqueiam; origem descarrega/reembolsável/adiantamento recusa com causa específica; recibo original mantido; evento de restabelecimento preserva cadeia; nenhuma nova linha receivable/payment/movement; UI/revisão/exportação mostram ambos valores e autoria.

Esta proposta oferece uma correção completa de representação da família já adotável. Não alega corrigir toda despesa financeira nem toda descarga; as famílias que alteram obrigação real são etapas próprias, com contratos de compensação ainda necessários.
