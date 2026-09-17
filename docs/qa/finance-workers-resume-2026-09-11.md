# Retomada delimitada dos workers financeiros

43147 (rollouts/20260911043147_finance_known_workers_resume_via_api.sql), SHA256 aa47d5fa2636bef31cc2450b77728fa5b89cc35ace40f445c225187978b6cd26, criada via CLI. Apenas cron.alter_job(active=>true) nos dois nomes existentes, sem executar worker no rollout. Sem grants, alterações de owner ou escrita direta em cron.job. Advisory próprio serializa este rollout; não coordena alterações administrativas externas. Descritores exatos antes/depois e hashes/ACL/config dos quatro processadores são conferidos. Exige readiness e gate não staged-false.

42530 permanece como evidência: tentativa do coordenador falhou por falta de permissão para LOCK cron.job. SELECT remoto posterior confirmou ausência no histórico e jobs24/25 pausados. Não houve retomada por este agente.

## Testes

financeWorkerResumeGuards.test.ts: 1 PASS com cadeia financeira real PGlite, metadados Cron locais e alter_job sentinela que SEMPRE rejeita execução. Prova retry já ativo sem alteração, rejeição de descritor divergente antes da primeira chamada e rollback da tentativa de chamada; não prova retomada bem-sucedida em pg_cron. financeFiscalQueueScreen.test.tsx: 3 PASS; ESLint0 nos três arquivos modificados. Total4 PASS em3.70s. Sem PG nativo/TSC.

## Base histórica observada

85 observações, zero bases projetáveis atualmente. CTe13 autorizados com invalid_receivable_amount; CTe47 autorizados com autorização incompleta e valor inválido; CTe10 rejeitados com autorização inativa/incompleta e valor inválido. NFSe13 autorizadas sem evidência completa; NFSe1 autorizada também com retenção ausente e conflito líquido; NFSe1 cancelada sem autorização ativa/completa. Consulta agregada adicional constatou fração de centavo nos70 CTe desta captura. Isso não redefine o código invalid_receivable_amount, que cobre outros valores inválidos. Não arredondar nem alterar a fonte.

A retomada pode classificar essas pendências em review, sem criar títulos para bases inválidas. Não significa carteira completa. Em /financial/fiscal-queue a revisão é o filtro inicial, com status/contadores e motivos traduzidos; rótulo de valor permanece amplo. Dashboard explicita origens incorporadas e fila pendente.

## Pós-execução pelo coordenador

Usar finance-workers-resume-checks-2026-09-11.sql antes e após duas janelas de minuto. Confirmar somente os dois jobs ativos; histórico43147; execuções sem erro; distribuição pending/review/applied; investigar automatic_projection_retry/failed. Comparar contagens monetárias: estes workers não emitem documentos fiscais nem fazem transferências bancárias. Fiscal cria/atualiza cobranças contábeis (incluindo revisão/crédito quando aplicável), reconciliação registra evidência sobre movimentos existentes. Outros usuários podem alterar contagens concorrentes; diferença exige atribuição, não inferência automática de fraude. Não executar workers manualmente como parte desse check.
