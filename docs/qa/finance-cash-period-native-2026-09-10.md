# Caixa físico — PostgreSQL nativo

2026-09-10. Suite finance-cash-period, script scripts/test-finance-cash-period-native-cases.mjs. PostgreSQL17.11 local descartável, sem remoto.

Hashes congelados:73906 `c5a8e1039831002b94b39f4ef870d5c641c835533df63c97c9961209ec0377e5`;74142 `503db8a0716759a73c7d3d9baac3b11c4af6801c800677dc6db811708bf3df68`;72624 `81a04b56856933edce8341a07743d5b977e7a688b877d6cafebaf4fe680d4394`.

## Achado reproduzido antes de patch posterior

Handle90510: primeiro positivo de adiantamento cash+banco passou. Criar segunda conta cash após fechar a primeira falhou com finance_closed_account_identity_conflict em63109. Comparação de campos bancários não restringe account_type; nulls também viram strings vazias e colidem. Reportado ao core; nenhuma alteração73906/74142. Rodada intermediária59844 pré-cria contas antes de fechar para testar os demais cenários; isso não corrige nem comprova resolução do achado.

## Matriz

- Adiantamento50 pago20cash/30banco, comandos reais; fechamento cash de100 para80, footprint bancário não somado.
- Transferência real banco→cash20, duas pernas; fechamento cash120 sem receita artificial.
- Abertura100, entrada10, saída25, contagem85 e close/reopen reais; evidência histórica passa schema e integridade completa, bankentries permanecem vazias.
- Falta5/sobra5 persistidas no histórico, reversão identificável, fechamento bloqueado sem ajuste monetário automático.
- Contagemzero, close vence corrida contra dinheiro retroativo; reversão da contagem congelada bloqueada.
- Reversão de contagem vence corrida contra close com revisão anterior; nenhuma closure daqueleaccount é criada.
- Fechamento contíguo do mês seguinte impede reabertura do predecessor.
- Replay concorrente de contagem cria uma; acesso do responsável revogado durante espera de close rejeita.
- Leitor de contagens recusa motorista; conta bancária não aceita contagem de caixa.

## Contratos e limites

Schemas reais cashPeriodPreviewSchema/cashPeriodCountsSchema/resultados e accountPeriodEvidenceSchema verificam retornos. Contrato cashPeriodContract é transpilado em memória, sem modificar schemaUI, para resolver importsTS sem extensão no Node nativo.

Fixture deriva cadeia real de abertura/cobertura/guards/B/paidprojections. Apenas cash usa contagem; não são instalados dados de extrato para aprovar caixa. Declaração física é criada por RPC real, mas o ensaio não comprova numerário existente. Movimentos, transferências, pagamento, revisão, close e reopen usam comandos reais. Fonte empregado/título é semeada. Schema baseline com dependências restritas/FKs externos omitidos, não ensaio da plataforma inteira nem implantação.

Rodada intermediária59844:9passed/exit0/parado, com contas pré-criadas. Rodada final18402: **10 testes passaram, exit0, PostgreSQL parado**.

Patch175310 `0de48bf482ee3bed0aa4e8985b43382822a37e946f807bdfcb38d8fe89b5cc63` instalado depois das migrações congeladas. Pré-criação retirada: cada cenário cria nova conta cash com campos bancários null depois do fechamento anterior, comprovando a regressão90510 corrigida. Proteção da própria conta e comparação bancária foram cobertas pelos testes específicos do autor, não por identidade bancária completa nesta suíte.

Auditoria65830 `af579d29457377bf3d612aafa5105af8939f7aba369565f2956ef53ed85a63e1` +74822 `cef4cdafd97172a150bcf3c98d198ac10711b42afab992004506979737fc2c81`: consultas reais manual_only por cash_period_count_recorded/reversed, cash_period_closed e account_period_reopened retornam eventos e todos preservam manual_intervention, validados por financeAuditSchema real. Log node_modules/.cache/qa-postgres/finance-cash-period-native-2026-09-10.log.
