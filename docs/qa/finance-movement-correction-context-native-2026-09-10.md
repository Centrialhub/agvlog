# Contexto de correção — PostgreSQL nativo — 10/09/2026

**5 testes passaram**, PostgreSQL17.11 local. Execução final70962 terminou exit0 e servidor parado. Execução inicial52135 terminou exit1/stopped por import UI indireto sem extensão em Node; removidos imports não usados do harness, sem alteração de SQLproduto.

Script `scripts/test-finance-movement-correction-context-native-cases.mjs`, selector `finance-movement-correction-context`. Log `node_modules/.cache/qa-postgres/finance-movement-correction-context-native-2026-09-10.log`.

90516 SHA256 `aefa6e937c708cf31e983c7bf6bdfef8a2e788ed68bcf0683a67b4c256367b32`.
90635 SHA256 `0a39c5eddc9c3ecb553c782ae3ccb7510333970cff0d8cefd07d2a25e3b8bd06`.

## Provas

- Movimento livre criado pelo RPCreal tem preview público estável e schema real válido; efeitos de saída/entrada corretos e `can_execute=false`, sem void ou dinheiro adicional.
- Pagamento real por `apply_finance_payable_movement` cria cadeia monetária que bloqueia correção; pagamento e título aparecem no grafo.
- Desativação de trigger real altera readiness e bloqueia; reativação restaura elegibilidade do contexto livre.
- Tenant estrangeiro e usuário misto com motorista são recusados pelo wrapper público.
- Fechamento histórico sem dependencyID do movimento bloqueia apenas pelo intervalo conta/data. Reabertura via RPCreal remove o bloqueio, preserva fechamento/reabertura no grafo e altera a revisão.

## Limites

A fixture nativa reutiliza o grafo real de cash/period/paid-chain previamente ensaiado e aplica corpos atuais de `voidAwareMonetaryProofDatabase` e `movementCorrectionContextDatabase`, além do wrapper90635. Não há função substituta de sucesso para readiness/origem/intervalo. Persistem os limites de schema e FKs das factories focadas; não equivale a ensaio integral do deploySupabase.

O fechamento do teste de intervalo é fixture histórica com ticket interno e snapshot mínimo, não nova prova de fechamento positivo. Não instala191905 e não testa voidRPC. Fingerprint detecta deriva do estado de instalação; o ensaio não transforma autocaptura de hash em aprovação absoluta da implementação. Nenhum acesso remoto, nenhum SQLproduto alterado, PostgreSQL parado.
