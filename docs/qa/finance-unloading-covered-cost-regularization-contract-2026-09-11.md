# Regularização de custo coberto/pago — contrato para implementação

Estado: proposta revisada conforme decisão do root; nenhum SQL/writer nesta rodada. Reutilizar60519/60700, preservando título, pagamento e alocação históricos. A cobrança da descarga continua independente de quem prestou o serviço ou recebeu o dinheiro.

## Decisão monetária

| Fonte original150 | Custo vigente | Cobertura econômica | Disposição pendente | Reserva do movimento | Banco |
|---|---:|---:|---|---:|---:|
| Envio ao motorista alocado150 |120|120|driver_custody30|150|−150|
| Título150 efetivamente pago150 ao prestador |120|120|payment_recovery30|150|−150|

No segundo caso payable.amount=150, paid_amount=150, pagamento/link150 permanecem INTEGRALMENTE. A carteira mostra título histórico pago150 e ativo recuperável30 separado. Não reduzir nominal/paid_amount para120, não converter pagamento em baixa parcial e não gerar novo payable. O KPI de custo mostra120.

No primeiro caso a alocação original150 permanece. Sua cobertura econômica do custo passa a120; os30 restantes são responsabilidade identificada do motorista, não crédito contra o fornecedor devedor da descarga.

Em ambos, movimento/linha bancária/conciliação150 ficam intactos e movement_used_cents continua150. Os30 NÃO são capacidade livre para outro pagamento. São saldo pendente rastreável com responsável, sem afirmar dinheiro devolvido. Os dois casos são alternativas: duplicidade de fontes cobrindo o mesmo custo exige diagnóstico, não soma ou escolha silenciosa.

## Estrutura única e preservação dos hashes

Nova tabela privada append-only `expense_cost_regularizations`: id,tenant_id,expense_id,charge_id,payable_id nullable,request_id,actor_id/name,reason,created_at,ordinal,previous_regularization_id nullable,base_amendment_id nullable,revision_before,cost_before_cents,cost_after_cents,source_snapshot,materializations_before/after,result. Nenhuma nova coluna em expenses, amendments60519, pagamentos, alocações ou movimentos; nenhuma atualização de seus snapshots históricos.

A cadeia começa na revisão íntegra60519 da mesmaexpense. Fullycovered por envio pode legitimamente ter payable_id null: não criar título fictício para caber no journal60519, que exige payable não nulo. Após primeira regularização, novos ajustes passam pelo coordenador, evitando bifurcação pelo writer antigo. Revisões anteriores e to_jsonb dos registros anteriores devem permanecer byte-equivalentes.

Tabela filha `expense_cost_dispositions`: id,regularization_id,tenant_id,source_kind ('expense_allocation'|'payable_link'),source_id,movement_id,previous_disposition_id nullable,gross_reserved_cents,applied_cents,residual_cents,disposition_type ('driver_custody'|'payment_recovery'),responsible_type/id,source_snapshot. Uma posição vigente por fonte pela cadeia; revisões sucessivas são snapshots substitutivos, não valores a somar. Cada fonte satisfaz gross_reserved=applied+residual.150→120→100 resulta residual50, não80.

Responsável é comprovado por batch/comando/link e identidade original de quem recebeu. Não usar nome atual nem o fornecedor devedor da cobrança por conveniência. Fonte, contraparte ou capacidade global não comprovadas produzem blockers com IDs.

`expense_cost_effective` permanece o ponto único de custo: primeiro valida a cadeia60519 intacta, depois aplica a extensão. DTO conserva original/effective/history/revision e acrescenta `regularization` com id, gross_reserved_cents, applied_cents, residual_cents e disposições. Origem de entrada no histórico deve identificar regularization ou amendment, sem reescrever entries antigas. Alterar schemas de resposta/clientes conjuntamente, sem alterar schemas físicos históricos. Competência original permanece; captured_at não significa as_of/commitvisibility.

## Preview e comando

`preview_finance_unloading_cost_regularization(_tenant_id,_charge_id,_proposal)`.
Proposal={amount_cents:string,dispositions:[{source_kind,source_id,applied_cents,disposition_type,responsible_id}]}. A proposta é explícita por fonte; servidor valida cobertura integral do grafo e responsabilidades, sem aceitar soma agregada como prova.

Resposta v1={tenant_id,actor_id,charge_id,expense_id,payable_id|null,revision,cost_origin,source_rows,dispositions,obligation:{action:'preserve_historical',nominal_cents,paid_cents,open_cents},materialization_plan,blockers,eligible,can_execute,effects}. Source_rows trazem IDs de movimento/alocação/link/payment e gross_reserved/applied/residual. Valores exatos em strings; null somente com diagnóstico.

Effects={cost_before_cents,cost_after_cents,cost_delta_cents,cash_changed:false,payable_changed:false,reconciliation_changed:false,movement_capacity_released_cents:'0',driver_custody_cents,payment_recovery_cents}. Valor pendente30 deve aparecer na confirmação e na carteira; não usar apenas aviso textual.

`regularize_finance_unloading_cost(_payload)`={version:1,tenant_id,request_id,charge_id,expense_id,payable_id|null,revision,proposal,reason}. Resultado inclui regularization_id,disposition_ids,identidades e os efeitos confirmados. Replay exato por ator/payload; última falha desfaz journal/disposições/materializações/eventos/command.

Prioridade implementável: gasto integralmente coberto por envio ou título integralmente pago, com fonte íntegra. Se há complemento ainda aberto que ficou incorreto, o preview deve mostrar seu plano específico de correção/cancelamento auditado antes de executar; não deixar dívida indevida sob o rótulo preserve_historical. Essa ramificação reutiliza a distinção custo/obrigação dos cancelamentos existentes, preserva nominal original e nunca cria segundaexpense. Não é resolvida por alterar paid_amount histórico nem por forçar saldo líquido zero.

## Disposição e resolução posterior

Disposição nasce `pending` e continua reservando o dinheiro original. `resolve_finance_cost_disposition` deve distinguir retorno real (entrada registrada e vinculada), compensação autorizada contra outra obrigação da mesma contraparte e nova prestação de contas autorizada. Nenhuma delas é executada automaticamente ao corrigir custo.

Retorno real30: nova entrada30, banco líquido−120, residual0; saída/conciliação150 preservadas. Compensação30: banco não muda, crédito é consumido contra obrigação identificada, sem reutilizar o movimento150. O saldo pending é um resultado explícito válido da retificação econômica, mas não equivale a devolução/compensação concluída. Não oferecer botões de resolução enquanto respectivos comandos e provas não existirem.

## Integrações obrigatórias, sem redesenhar o título pago

1.60519 resolver/guards e cancelamentos: cadeia nova, payable nullable e disposições protegidas. A igualdade atual payable.amount=effective_cost não vale para título histórico150 com recuperação30; aceitar apenas quando a nova prova demonstra essa decomposição. Não flexibilizar nominal genericamente.
2.60700 recorded_costs/summary/list_expenses: KPI120; allocated/applied econômico120, gross_reserved150 e residual30. Fórmula atual effective_amount−allocated_raw produz−30: substituir por projeção comprovada, não clamp silencioso. Registro original e anexos permanecem no histórico.
3.134943 settlement_expense_context/60700: hoje allocated150>cost120 vira needs_review. Reconhecer a decomposição explícita, preservando diagnóstico quando ela faltar. canonical_trip_costs mostra120 e inclui gross/applied/residual no novo snapshot.
4.180040/50116 carteira: título nominal/pago150 continua válido; exibir recuperação30 separada com responsável, origem, saldo e status. Não criar artificialmente overpaid150/120. Não há razão para alterar `_recalc_payable_paid` ou o check de nova baixa neste caso, pois o título histórico continua150/150.
5.movement_used_cents, opções e conciliação: reserva150 permanece. Novos guards impedem reversão03529/143833/132411 que libere fonte enquanto existir disposição ativa sem resolução auditada. A reversão de baixa atribuída incorretamente é outro comando coordenado, não devolução física. Guardas novos usam trylock40001; preservar funções capturadas190516 quando não houver mudança funcional necessária.
6.Acerto materializado: preservar snapshot anterior e registrar revisão auditada da composição, com custo120 e pendência30 identificada. Reutilizar builder/eventos em estado reaberto/revisável; requer nova conferência/aprovação quando afetada. Crédito/débito233637 altera obrigação do motorista e NÃO substitui correção do custo canônico. Custo não reembolsável continua sem gerar segundo crédito.
7.Fechamento/folha/corte: identificar fontes afetadas e usar reabertura auditada onde exigida. Não alterar composição protegida sob fechamento ativo; revisão antiga permanece como história. Obrigações/pagamentos de folha efetivamente dependentes exigem plano específico, não baixa/desconto implícito.

## Ordem e provas

1.Journal/resolver/disposições privados, sem coluna nova nos objetos históricos; capturar hashes de expense/amendments/payable/payment/allocation/movement/snapshots antes/depois.
2.Integrar leitores econômicos, carteira de pendências, acerto e guards de reserva/reversão; conferir catálogo/readiness efetivos.
3.Coordenador privado com fiscal→finance→reauth→grafo/locksNOWAIT→revisão→journal+disposições+materialização auditada+evento/command; nenhuma criação de movimento nem alteração do título pago150.
4.Testes reais: envio150/alocação150→120+custódia30; payable150/payment150→120+recuperação30 preservando todas as linhas;150→120→100; movimento compartilhado; complemento aberto explicitamente planejado; acerto materializado; fechamento/reabertura; replay/rollback/tenant/misto; tentar reutilizar30 ou reverterfonte com disposição ativa deve falhar. Consulta do período continua saída/conciliação150.
5.Só promover preview/command/UI depois de consumidores e pendências visíveis integrados. O escopo não termina em trocar o KPI: precisa mostrar e proteger o saldo30 até sua resolução própria.
