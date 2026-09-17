# Adiantamento de funcionário: prova do caminho pago

Teste independente `src/test/employeeAdvanceRecordedPaymentReview.test.ts`, helper próprio `src/test/helpers/employeeAdvanceRecordedPaymentReviewDatabase.ts`: 4 PASS em 11/09/2026 às 09:44:09, saída0, 3,28 s. ESLint saída0. Nenhum SQL de produto ou UI alterado; nenhuma leitura/escrita remota.

## Resultados

1. Cadastro com `_mark_paid=true`: fronteira atual35125 rejeita55000 finance_advance_payment_requires_command; não deixa adiantamento nem dinheiro.
2. Cadastro pendente sem título seguido pelo UPDATE authenticated usado pela UI: grava statuspaid/paid_at/paid_by com payable_idnull. Guardas finance_closed_period_source e finance_late_paid_projection presentes e ativas; SET CONSTRAINTS ALL IMMEDIATE passa. Zero banco e zero payables_payments. paid_projection_chain é inválida com advance_title_chain_invalid. Sem período fechado, a guarda tardia retorna antes de exigir cadeia paga.
3. Cadastro com título, aprovação controlada na fixture e saída real de40 vinculada por apply_finance_payable_movement: título pago40, adiantamento permaneceapproved, um footprint. O helper legado para pago integral acusa advance_not_paid. O builder de folha existente filtra statuspaid e usa nominal do adiantamento, portanto não serve como composição parcial.
4. Mesmo caminho com100: título e adiantamento pagos, prova íntegra e um footprint. Vínculo não cria segunda saída: banco permanece byte a byte igual ao registro do movimento.

## Contrato atual e limites da fixture

register_employee_advance(tenant,employee,amount,date,reason,method,reference,create_payable,mark_paid) é o corpo baseline protegido pela35125 com preflight exato. O comando não aceita movimento, revisão ou requestid. paid_projection_chain exige título único, fonteemployee_advances, pagamentos ativos e links/movimentos reais, integralidade.

Fixture herda fullfinance de custos/créditos/devoluções/carteira/períodos. Restaura funções/políticas baseline is_tenant_member e employee_advances, register e35125, recalc com active_payable_payments conforme03529, sync_employee_advance_from_payable e gatilhos, índice uq_payables_source_category. Identidade e schema de base são fixtures limitadas; não se afirma paridade completa das políticas de produção. Aprovação do título positivo usa UPDATE controlado de fixture, não prova API85400. Não foi gerada folha neste primeiro teste; o efeito do filtro statuspaid foi identificado no builder, não inferido de um ensaio executado.

## Próxima correção delimitada

Comando canônico deve vincular saída existente ao saldo do adiantamento, com parcialidade, contraparte, revisão, requestid e prova. A UI não deve oferecer o atalho que35125 rejeita. Paid precisa ser projeção de evidência integral, sem impedir approved com pagamento parcial. Folha deve incorporar somente a parcela entregue, conservando competência advance_date e snapshot dos vínculos, sem nominal fictício nem alterar composição aprovada/fechada. Integração da folha será migration separada após contrato da posição124237 estabilizar.
