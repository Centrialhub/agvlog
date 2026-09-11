# Cancelamento manual — concorrência PostgreSQL nativo

2026-09-10. **6 testes passaram em PostgreSQL17.11**; handle17018exit0, servidor parado. Nenhuma alteraçãoSQL/remota.

81257 SHA256 `524e93c21de27fcb3bb5b46720bc8e340304efc6d2be086460e249e3d19cb50a`;81549 `6ed93d5ec9d655f67adbfd9edd29b6335336d3eaa013d6f15c30683a5f8b5ed4`.

Script scripts/test-finance-manual-expense-cancellation-native-cases.mjs; selectorfinance-manual-expense-cancellation; log node_modules/.cache/qa-postgres/finance-manual-expense-cancellation-native-2026-09-10.log.

1. record_finance_manual_expense com comprovante real da fixture, preview/cancel/replay reais. Título cancelado e evidência preservada. DELETE storage e reativação título rejeitados.
2. Replay simultâneo cria uma cancellation.
3. Ordem adversarial manual: sessãoA segura rowlock no payable sem finance; sessãoB chama cancelRPC, pega finance e espera rowlock. Espera observada via pg_blocking_pids. A executa UPDATE existente; trigger retorna **40001 finance_dependency_busy**, capturado em subtransação que desfaz UPDATE. A registra estado/erro em tabelaQA e libera row; B conclui cancelamento. Notes não mudaram, status finalcancelled.
4. Mesmo cenário adversarial para cancelamento canônico75641 com guard atualizado81257; mesma prova40001, rollback e término sem deadlock.
5. Revogação de autorização após espera na travafinance rejeita sem evento de cancelamento.
6. Dois comandos originais declarando mesmo título tornam identidade ambígua; preview/cancel rejeitam.

As duas inversões usam UPDATE real de linha existente após bloquear cancel, não apenas RPCs que já seguem finance→row. Se guard esperassefinance, haveria ciclo; teste exige especificamente serialization_failure40001 com mensagemfinance_dependency_busy, não captura deadlock40P01 como sucesso.

Schemas reais manualExpenseCancellationPreviewSchema/ResultSchema analisam respostas. Fixture herda grafo real de lote/estoque/manutenção/folha da suíte anterior, instala120756/125034/81257/81549. Storage.objects é fixturelocal mínima, não serviço externo ou prova de autenticidade. Não ensaia fechamento positivo, todo grafoFK remoto, nem auditoria manual posterior que root implementa separadamente. Nenhuma função/trigger foi desabilitada para produzir sucesso.
