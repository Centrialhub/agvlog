# Carga/viagem — concorrência, espelhos e recuperação

Estado em 31/08/2026: **candidata publicada e inconsistência histórica reconciliada**.

## Problema reproduzido e correção

O ensaio nativo reproduziu `40P01: deadlock detected`: a transição operacional mantinha a carga bloqueada e esperava a viagem, enquanto a entrega mantinha a viagem e esperava a carga. Não se inferiu concorrência apenas pelo disparo simultâneo de chamadas.

- RPCs de início/transição passam a adquirir viagem → vínculos canônicos → cargas, com ordem estável e revalidação após espera.
- Triggers de vínculo e verificadores diferidos podem entrar com uma linha filha já bloqueada. Usam `NOWAIT` para rejeitar conflito com `40001`, sem formar espera circular; não usam `SKIP LOCKED` para validar integridade.
- Inserção concorrente da mesma carga em duas viagens não deixa dois vínculos ativos. Repetir depois do commit continua recusando a segunda atribuição.
- UPDATE do vínculo passa a atualizar ambos os espelhos e marcar ambos os acertos afetados para recálculo. DELETE conserva uma carga representativa restante no espelho da viagem.
- Desvincular/revincular na mesma transação pode passar por estado intermediário, mas commit órfão de carga em trânsito continua bloqueado. Isto **não** implementa transferência completa de paradas/documentos.

## Evidência de backend

`scripts/test-delivery-concurrency.mjs` executou **20 casos aprovados** no PostgreSQL 17.11 portátil, somente loopback, sem serviço Windows. O servidor foi encerrado e a consulta independente de processos não encontrou PostgreSQL desse cache ativo.

| Grupo | Casos cobertos |
| --- | --- |
| Entrega/chegada/saída (8) | Replay e resultados conflitantes; DELETE/UPDATE de vínculo bloqueado; ordem viagem/parada; saída única; identidade revalidada após espera |
| Carga/início/alocação (8) | Transição versus entrega; unlink e escrita direta conflitantes; dois inícios; hold; reatribuição de motorista; unlink após início; alocações concorrentes |
| Financeiro (2) | Encerramento só da viagem reverte acerto automático; entrega versus transição mantém resultado e acerto pendente, sem pagamento |
| Recuperação (2) | Recusa de versão divergente sem alteração parcial; restauração exata e reaplicação preservam toda a evidência de negócio |

Nos cenários que devem aguardar, `pg_blocking_pids()` comprova a espera. Nos conflitos NOWAIT, a sessão concorrente deve falhar com `40001` enquanto a primeira continua aberta; esta então bloqueia o restante do grafo para confirmar que não ficaram locks filhos retidos.

A fixture nativa usa chaves estrangeiras e funções reais capturadas de espelhamento, duplicidade, recálculo e criação de acerto. Ramos externos são instrumentados; nenhum provedor fiscal, pagamento ou SSX é acionado. O hospedado consultado usa PostgreSQL 17.6, e a fixture 17.11 não reproduz RLS/Auth/Storage/PostGIS completos.

PGlite: **37 testes** de invariantes e **13 de rollout/recovery** passaram. Recuperação restaura corpo, comentários, permissões e trigger original; reaplicação não duplica partida nem apaga histórico. Mudança de corpo, grant, trigger ou dependência inesperada interrompe e reverte o processo.

## Evidência de frontend

**35 testes direcionados aprovados**: hook de início (13), tela de cargas (4), transição operacional (6) e contratos de resposta/erro (12).

- Conflitos `40001`, `40P01` e `55P03` orientam atualização e repetição manual, sem retry automático da mutação.
- Consultas interligadas de motorista/operação são invalidadas em sucesso e erro. Falha de refetch não mascara o resultado original.
- Resposta ausente ou de outra carga/viagem não é tratada como sucesso; não há navegação ou continuidade do fluxo dependente dessa confirmação.
- Cliques de início repetidos durante o envio não disparam chamadas duplicadas.
- Em `LoadDetail`, o passo de CT-e subsequente cria registro interno, não transmite ao Hub/SEFAZ. Esta revisão não executou esse fluxo nem alterou `useGenerateCTe`.

Testes renderizados usam backend simulado: não equivalem a E2E autenticado nem a validação visual do formulário publicado.

## Artefatos e próximos critérios

- Publicada como `supabase/migrations/20260831230903_enforce_trip_load_transit_invariant.sql`.
- Captura anterior: `TRIP-LOAD-ROLLOUT-CONTRACTS-2026-08-30.json`.
- Recuperação guardada: `TRIP-LOAD-RECOVERY-2026-08-30.sql`.
- Critérios de promoção e limites: `ENSAIO-CARGA-VIAGEM-2026-08-30.md`.

Antes de promover: revisar e ensaiar `dispatch_planned_route`, escritores legados e reatribuição de paradas/documentos com o schema/RLS reais; validar cliente antigo e novo; testar motorista/operação autenticados; reconciliar dados antigos explicitamente. `plan_dispatch_start_trip_v1` foi conferida no destino: execução negada a `anon`/`authenticated`, disponível a `service_role`; não foi confirmado bypass público nessa função.

A carga 1003 foi reconciliada em produção pela versão
20260831230957_reconcile_load_1003_no_start_evidence: load.status=ready,
viagem planned e actual_start_at nulo. A decisão foi baseada na ausência de
eventos de início, provas, histórico operacional e documentos ativos; uma
auditoria explícita foi gravada. Nenhum horário de teste foi convertido em
horário histórico. Após a correção, a contagem global de violações ficou em
zero. Fiscal real e SSX permaneceram inativos durante o QA, sem contratação
ou gasto adicional.
