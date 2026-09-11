# Concorrência: lote canônico × builder de acerto

**6 testes passaram em PostgreSQL 17.11 nativo** descartável/loopback, sessão90294 saída0. Runner confirmou parada do servidor. Não houve alteração SQL/UI/remota nesta frente.

## Evidência da disputa

1. **Builder primeiro:** segura trip/acerto; `record_finance_expense_batch` aguarda. `pg_blocking_pids` comprova a espera antes de liberar o holder. Após ambos commits, o snapshot ainda não contém o custo novo e `needs_recalculation=true`. Rebuild posterior inclui R$150 e limpa a pendência. Replay do mesmo lote e novo rebuild mantêm dois derivados e somente um título complementar de R$60.
2. **Lote primeiro:** depois de executar o comando real, a transação do lote permanece aberta. Builder em outra sessão recebe `55P03` ao tentar trip `FOR UPDATE NOWAIT`; a sessão holder ainda está viva. Commit do lote mantém a flag. Retry do builder inclui todos os custos e não cria reembolso/crédito do motorista.
3. **Acerto approved:** lote em transação e tentativa concorrente de rebuild não alteram snapshot/custo/status protegido; depois do commit fica apenas a pendência. Retry posterior é rejeitado com `settlement_locked`.
4. Mesmo comportamento para **paid**.
5. Mesmo comportamento para **closed**.
6. **Linha do acerto ocupada por outro writer:** trigger do lote recebe `55P03` NOWAIT. Todo lote, itens, título complementar e comando são revertidos; nenhuma flag parcial persiste. Retry após liberar o holder grava uma vez e o rebuild inclui o custo.

As verificações comparam snapshot protegido, custos, status, flag, contagem de itens canônicos/derivados, títulos e pagamentos de acerto, além do conteúdo completo do movimento preexistente. Nenhuma espera permanente/deadlock ocorreu; os caminhos NOWAIT falham com rejeição explícita e ficam recuperáveis por retry.

## Candidatos e fixture

Migration134948 SHA256: `05ab3155f07c0e92cf23cca56cc6f671562b4ac300ba973406652ec5c87d5c0e`.

Comando real de lote213959 SHA: `3d24b8f562d043eccf99189255e19a1c9d4ce9827341a0348136562963ea0dc3`.

Builder real da migration `20260831114316` com patch134948; schemas/defaults/enums baseline iguais à fixture `financeCanonicalTripSettlement.test.ts`; migrations de descarga, lote, projeção de folha000731, dedup132406 e lifecycle133352 instaladas. Todos os hashes constam do log.

As funções de documentos de viagem e KM são dependências explícitas da fixture retornando vazio/null. Esta suite não homologa conciliação de documentos, rotas, reentregas ou todos os writers operacionais. A integração de custos/folha foi testada na suite PGlite específica; aqui a cobertura é a disputa lote/builder e proteção do snapshot.

## Arquivos e reprodução

- `scripts/test-finance-trip-cost-builder-native-cases.mjs` — casos próprios.
- `scripts/test-delivery-concurrency.mjs` — selector adicional `PG_QA_SUITE=finance-trip-cost-builder`.
- `node_modules/.cache/qa-postgres/finance-trip-cost-builder-native-2026-09-10.log` — log integral.

Executado com `node --experimental-strip-types scripts/test-delivery-concurrency.mjs` e o selector acima. Ambos os scripts passaram `node --check`.

Esta evidência complementa a limitação de concorrência ainda não nativa registrada no relatório anterior `finance-canonical-trip-cost-settlement-2026-09-10.md`. Não substitui ensaio completo de migração, browser ou implantação.
