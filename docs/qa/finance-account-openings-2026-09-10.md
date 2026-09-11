# Abertura bancária — validação SQL executável

Validada a migration `20260910140010_finance_account_opening_balances.sql`, sem alterações no SQL ou na interface.

SHA-256 validado: `799f25034f6f3964b32e7da896ebffa589d8bb0fc623b03ae1cd1f13e5964c9c`.

## Evidência executada

`npx vitest run src/test/financeAccountOpenings.test.ts src/test/financePeriodEvidence.test.ts`: **25 testes passaram**, dos quais 14 são novos de abertura e 11 de evidência do período. `npx eslint src/test/financeAccountOpenings.test.ts` passou sem apontamentos.

`npx tsc --noEmit -p tsconfig.app.json` terminou sem erros no novo teste; a execução global permanece reprovada por um erro externo em `src/pages/driver/DriverDeliveries.tsx:345` (`unknown` para `string`).

A nova suíte usa a mesma fixture de dependências de `financePeriodEvidence`: fundação real do ledger e migrations reais de consulta, importação, verificação, auditoria, OFX, identificação bancária e evidência. Executa funções e gatilhos reais em PGlite, com o papel authenticated e claims dos atores. Não substitui RPCs por mocks.

Os casos confirmam:

- Saldo inicial derivado da âncora identificada, inclusive negativo, sem criar movimento ou receita; valor arbitrário no comando é rejeitado.
- IDs da importação e verificação preservados na evidência da abertura.
- Replay exato mesmo após mudança da evidência; reutilização divergente da chave e revisão desatualizada rejeitadas sem resíduos.
- Uma abertura ativa por conta; reversão auditada, replay, nova abertura após reversão e histórico imutável com autoria permanente.
- Abertura e reversão aparecem no filtro de intervenções manuais da auditoria.
- Nova verificação da âncora, mesmo conservando o valor, exige revisão; âncora contraditória também exige revisão sem reescrever a abertura salva.
- Motoristas e perfis mistos sem leitura, registro ou reversão; isolamento de tenant/conta estrangeira e proibição de escrita direta pelo papel authenticated.
- Caixa físico rejeitado; ausência de âncora, saldos contraditórios, data sem horário e fechamento com offset diferente de -180 rejeitados.
- Subperíodo carrega os movimentos anteriores desde a data efetiva; movimentos anteriores à abertura e posteriores ao subperíodo não alteram seus totais. Consulta anterior à data efetiva não fabrica saldo inicial.

## Limites

Esta é validação SQL em PGlite, sem concorrência entre sessões PostgreSQL nativas. A unicidade ativa foi testada sequencialmente; espera de locks e revogação de acesso durante espera não foram simuladas nesta suíte.

Os relatórios de leitura dos extratos são inseridos pela fixture como resultado de um leitor confiável; esta suíte não lê arquivos OFX nem atesta autenticidade do original. A abertura depende da âncora de saldo, não constitui prova de cobertura completa do período. A consulta mantém `can_close=false`, inclusive quando a abertura é válida. A integração de legado e o fechamento definitivo não são declarados concluídos.

Uma abertura que exige revisão ainda conserva seu saldo histórico e o cálculo do livro; isso não equivale a aprovação do fechamento. A interface deve preservar essa distinção.
