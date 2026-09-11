# Detalhamento posterior de dinheiro já fechado

Migration local `20260910164942_finance_closed_period_late_payment_composition.sql`, SHA256 `8909c59453111cdd2ca6d001f49707926c032c26a466a59adf3c5745e1c748e7`. Nenhuma aplicação remota.

## Problema corrigido

O guard imediato de INSERT em pagamentos/projeções tratava uma baixa tardia em movimento existente como novo dinheiro retroativo. Isso exigiria reabrir o banco apenas para detalhar a qual título pertencia um movimento já conciliado.

A correção posterga a prova de INSERT dessas projeções até o fim da transação. `finance_movements` permanece imediatamente protegido: dinheiro retroativo novo continua proibido. Não há GUC, flag de usuário ou declaração que dispense a prova.

## Prova final

- Movimento deve existir como dependência `money` de fechamento ainda ativo, na conta/dia exatos desse fechamento.
- Pagamento canônico deve apontar integralmente ao movimento por IDs, preservando empresa, valor, data, conta e título/acerto.
- Capacidade total compartilhada precisa respeitar o movimento: `movement_used_cents` para saídas; `receipt_movement_used_cents` para entradas, incluindo correções e associações existentes.
- Recibo e sua projeção bancária exigem comando/payment/bank_transaction/movement coerentes. Aliases de carga/fechamento exigem o recebimento exato e conta/dia/valor iguais.
- Pagável só aceita origem canonical ativa nessa exceção, sem bank_transaction legado; inserção de um registro antigo sem associação não vira permitida por coincidência.
- Autorização financeira é conferida novamente quando a prova diferida executa. Falha reverte pagamento, links e eventos pendentes.

As constraints são diferíveis e inicialmente diferidas. Um cliente que execute `SET CONSTRAINTS ... IMMEDIATE` antecipadamente escolhe exigir a prova naquele ponto; não há mudança silenciosa dessa decisão. As RPCs normais concluem a transação com o vínculo já presente.

## Auditoria e preservação

Snapshot bancário não muda. Cada projeção tardia aceita gera `closed_period_composition_recorded`, com ator, origem/ID e `cash_changed:false`, além dos eventos normais do comando financeiro. Replay não duplica esses registros.

UPDATE/DELETE continuam nas proteções anteriores. Inserções sem prova passam novamente pelo guard normal e são rejeitadas quando atingem o corte. Conta inexistente ou de outra empresa é considerada desconhecida no resolver, evitando classificá-la como simplesmente fora da conta fechada.

`account_period_guards_ready` passa a exigir as seis constraints diferidas ativas; não habilita fechamento se apenas o guard imediato tiver sido modificado.

## Testes

`closedPeriodLateComposition.test.ts`: **6 testes passaram**, ESLint código 0.

1. Comando real de alocação de pagável usa saída congelada, com flush final, replay exato, um único movimento e snapshot intacto.
2. Pagamento retroativo sem vínculo falha no flush e rollback remove tudo.
3. Novo movimento retroativo falha imediatamente.
4. Recibo/projeção bancária com cadeia exata passa na validação final, sem segundo movimento.
5. Conta de outra empresa é rejeitada na fronteira diferida.
6. Revogação antes da validação final aborta alocação e auditoria pendentes.

A fixture usa snapshots históricos para isolar a prova posterior. O comando de pagável é a implementação real extraída da migration; o caso de recibo monta a cadeia de tabelas explicitamente e não afirma executar o fluxo fiscal completo. Fechamento positivo real, correção canônica de recibo e concorrência PostgreSQL são ensaios independentes da integração.

## Escopo preservado

Esta exceção é composição de dinheiro comprovadamente congelado. Ela não permite alterar conta, data ou valor do banco, não autoriza novo movimento, não ignora capacidade e não dispensa conciliação de dinheiro ainda não fechado. Estoque/valorização de peças seguem uma frente separada.
