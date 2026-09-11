# Fixture combinada de opções de movimentos — 10/09/2026

`src/test/helpers/activeMovementOptionsDatabase.ts` exporta `createActiveMovementOptionsDatabase(): Promise<PGlite>`, `activeMovementOptionIds` e `seedActiveMovementOptionOrigins(db)`.

A base é `createLegacyReceivableAssociationDatabase`, que contém o ciclo operacional/fechamento comercial/recebíveis real. A fixture acrescenta tabelas baseline ausentes e dependências de despesas, pagamentos e acertos usadas também pelas factories legacyPayableAssociationDatabase e financeSettlementPaymentDatabase. Não há funções falsas retornando sucesso, saldo zero ou capacidade ilimitada adicionadas por esta extensão.

Quando tabelas de vínculos já existem na base, são instaladas as definições reais das funções e seus ACLs originais, sem recriar tabelas. O patch real de histórico/reversão de132411 é aplicado ao leitor de acertos. O leitor manual instala seu bloco completo de120756, incluindo wrapper público, revokes e grants. Legacy payable43833 é instalada integralmente sobre as tabelas já presentes. A base receipt mantém45616. Foundation182541 e query84543 são aplicadas ao final. **83506 não está instalada nesta factory**.

API do seed: `{payable,legacyPayablePayment,receivable,legacyReceivablePayment,settlement,settlementPayment,trip}`. Usa IDs de `operationIds` e conta `cf600000-0000-4000-8000-000000000001`, expostos em `activeMovementOptionIds`. Dia2026-01-20; pagamentos50reais; payable100/paid50 e acerto100/payment50. Recebível vem do comando real `createFinancialScenario`, cujo nominal é240, não100; pagamento legado50 é semeado com a rotina pre-cutoff existente que restaura a guarda antes das consultas. O seed não cria movimentos financeiros: testes consumidores registram movimentos reais antes de comparar candidatos.

Smoke `activeMovementOptionsFixture.test.ts`: compilação, seed e execução das oito definições reais passaram. ESLint: zero erros. O smoke usa chamadas privadas owner para diagnosticar dependências; **não é prova de ACL pública**. Testes públicos/schema completos são responsabilidade de `activeMovementOptions.test.ts` do coordenador.

Limites herdados: tabelas de vínculos na base receipt omitem FKs não relacionados; alguns schemas fiscais são estreitos; o grafo não corresponde a todas as migrations de produção. Não afirmar equivalência de deploy. Nenhum PostgreSQL nativo foi iniciado e nenhum dado remoto foi acessado.

Validação integrada adicional comunicada pelo coordenador: activeMovementOptions.test.ts passou 3 testes com as 8 APIs públicas e parsers reais sobre esta factory. O smoke privado acima continua distinguido dessa prova pública.
