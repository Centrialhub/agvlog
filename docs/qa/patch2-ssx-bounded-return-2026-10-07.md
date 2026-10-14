# PATCH2: volume SSX e retorno suspenso

Task patch2-ssx-bounded-return-20261007, owner CodexPatch2, worktree F:/AGVLOG/work/patch2-ssx-bounded-return-20261007. Sucessor criado pelo fork-frozen sobre 8d826d83f06db6204716cc808e55293efdd97af8; candidato anterior preservado. Delta local, sem promoção, push, migração aplicada, runtime externo ou dados produtivos. Este documento é o registro próprio do incremento; resultados finais e identidade estão no handoff selado.

## Problema e efeito

R1, P2 herdado: 16 posições com 499 violações por posição produzem 7.984 itens em 31 consultas. A revisão independente comprovou que v2 chama upsert v1 com todo o volume, excede os 5.000 itens e repete a janela após backoff. O limite de 8 MiB também continua aplicável. Isso é um defeito anterior ao fencing, não uma regressão de posse no v2.

O novo commit v3 aceita até 8.000 itens e o mesmo teto agregado de 8 MiB, divide os itens em lotes de até 1.000 e chama o upsert v1 dentro de uma única transação. Gate com token/lease, lock checkpoint antes de cursor, CAS e finish tokenizado continuam obrigatórios. Há um único ACK de sucesso por página; exceção em qualquer lote, ACK ou finish desfaz itens, cursor e continuação juntos. Cinco funções v1 e as duas v2 permanecem intactas em corpo, OID, ACL e configuração. Nova RPC invoker, search_path vazio, apenas service_role.

O orçamento de 32 consultas e limite de resposta de 500 permitem no máximo 16 folhas completas de até 499 itens (7.984). Respostas de 500 causam divisão; uma posição saturada falha sem ACK. Orçamento HTTP agregado de 30s e transporte DB de 10s permanecem; estes não provam cancelamento SQL. SET LOCAL 3s/15s é da transação da migration, não da RPC em runtime.

Cada página confirma só o prefixo completo. O result do checkpoint guarda versão3, posição atual do cursor, próxima posição e fim da janela. A chamada seguinte retoma apenas metadados coerentes com o cursor atual e o fim disponível. Retoma também páginas do overlap cujo ACK não aumenta o cursor, para não ficar repetindo o prefixo denso e perder atualizações tardias. Falhas/backoffs preservam esse result pelo contrato finish v1. Dedupe por account + provider_violation_id permanece. Volume acima de 8 MiB, posição individual saturada e provider indisponível continuam falhas explícitas sem avanço; esta correção não promete cobrir payload ilimitado.

R2, P2 operacional: se o ACK de falha é revertido e o fallback finish v1 grava apenas retry_at no checkpoint, voltar diretamente ao42c ignora esse cooldown. O11bc também contém ACK sem fencing e não constitui retorno homologado.

O arquivo return-gate-aware.ts é uma contingência suspensa. Mantém autenticação, workspace/account, role e capability; lê o gate escopado e o cooldown do cursor; responde deferred/paused usando o maior prazo aplicável de lease running, checkpoint retry e cursor rate_limited. Não chama provider, claim, ACK, finish ou upsert e não modifica SQL, inclusive após todos os prazos expirarem. A verificação de cron pode consultar sua RPC de autenticação de leitura. Erro de leitura responde rollback_state_unavailable e mantém suspensão. Este retorno sacrifica ingestão enquanto suspenso; retomar exige entrypoint fenced aprovado e drenagem.

## Ordem e critérios de aceite

Integrador revisa o suplemento fora do lote PATCH1: primeiro forward SQLv2 já selado20261007122904, depois o novo forward SQLv3 20261007131504. Não remover APIs legadas/v2. Antes de qualquer troca de Edge: suspender despacho, drenar workers antigos e confirmar ausência de consumidores em voo. Só então instalar bundle completo aprovado e reativar conforme autorização. Para contingência: suspender despacho, drenar, preservar gate/cursor/retry/violations e instalar o bundle pausado selado. Não devolver42c/11bc como rollback.

Aceite local exige: 7.984 itens concluídos; 32 posições em duas páginas sem perda/duplicação; atualização tardia no overlap; continuação preservada após429; erro de lote tardio e lease expirada revertem tudo; ACLs e account/token/CAS preservados; retorno checkpoint-only/cursor-only/prazos divergentes/lease ativa conserva snapshots e zero provider calls. Exige typecheck/lint/gates/testes no SHA exato e bundle do retorno com fontes transitivas e hashes verificáveis. O artefato local não autoriza sua aplicação.

A prova Native PostgreSQL multiconexão, Auth/PostgREST/Deno, SQL após timeout cliente e CI hospedado continua pendente de autorização específica. PGlite executa SQL real mas serializa comandos; mocks de autenticação não homologam Auth real. Baseline-candidate permanece bloqueado enquanto os dois forwards não forem registrados por processo suplementar do integrador. Nenhum guard deve ser suprimido.

## Evidência e limites históricos

Revisão independente de8d:42PASS, R1/R2 reproduzidos, nenhum defeito novo concreto de fencing v2. Esses resultados pertencem ao revisor e não foram incorporados à contagem do autor.

As tentativas preparatórias ssx-volume-before e ssx-volume-first-v3 não são contraprova válida de7.984: o fixture atualizava telemetry mas o trigger mantinha provider_position_id10. Preparação corrigida para alterar ambos; o teste corrigido confirmou7.984. Outra preparação precisou de cast bigint explícito e uma trigger sintética qualificando public porque a RPC usa search_path vazio. Os resultados finais substituem essas tentativas sem apagar seus logs.

source-map-js1.2.2 permanece o delta de dependência separado8a712dd5. Forge fiscal, Braces e Selector continuam residuais; análise de próximos deltas está em PATCH2-NEXT-DEPENDENCY-DELTAS-20261007.md. Nenhuma alteração de emissão fiscal foi feita. Audit externo negado e seis casos SQL agenda negados não foram repetidos. Zero chamadas reais SSX (3/3 já consumidas), Realtime externo, nova janelaA7, restauraçãoA13, novas credenciais ou serviço compartilhado.

## Fontes

- Revisão: C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/patch2-ssx-review-20261007/REVIEW.md e collector-limit-reproduction.json.
- Candidato anterior:8d826d83; docs/qa/patch2-ssx-fenced-finalization-2026-10-07.md.
- Testes próprios: ssxRuleViolationConcurrentRuntime, ssxRuleViolationBoundedRuntime, ssxRuleViolationGateAwareReturnRuntime e ssxRuleViolationsRetryRuntime.

## Transferência gerenciada de 07/10

O registro acima preserva o histórico do candidato anterior. Implementação atual na task patch2-ssx-loads-reconciled-20261007, base6f6361ce reconciliada com df6dfd publicado; port de bytes verificados e seis hashes de custódia confirmados. Old WIP encerrado/preservado, fonte8d congelada. A primeira rodada própria na nova base executou54 testes isolados PASS/0FAIL de SSX e source-map; resultado de working tree, posteriormente substituído por gates no SHA exato do handoff. D-P2-SSX-FENCE, D-P2-SSX-VOLUME/CT-SSX-R1, D-P2-SSX-RETURN/CT-SSX-R2 e D-P2-SOURCE-MAP. D-P2-IMPORT/CT-IMPORT-GROUP e CT-PROD-AUD-INGESTION-SCOPE documentados no registro específico de agrupamento. Nenhuma aplicação dos dois forwards ou bundle, publicação ou execução externa foi realizada.
