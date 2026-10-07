# SSX: contrato SQL de Retry-After — continuação isolada, 06/10/2026

Base preservada: `a19399268f77831dbe45f9ca61021b311b474639` (polling). Tarefa `ssx-cooldown-contract-20261006`, CodexSSX. Nenhum arquivo de produção, réplica compartilhada, Auth, Vault de credenciais, pacote fiscal ou fonte congelada foi alterado. Nenhuma chamada SSX adicional; orçamento externo anterior continua 3/3.

## Causa comprovada e escolha do limite

O handler e `ssxPost` propagam um `Retry-After` de 7.200 segundos, mas a função real `record_ssx_account_cooldown_v1` anterior rejeita qualquer duração acima de uma hora com SQLSTATE `22023`. O handler retorna `500/persistence_failure`; a unidade pode já ter seu backoff gravado, enquanto a conta fica sem cooldown global. Os testes executam esse estado anterior e repetem o mesmo caminho após a correção.

Foi adotado o limite **já existente** de 86.400 segundos: `ssxPost` em `_shared/ssx-utils.ts` e `finish_ssx_sync_checkpoint_v1` em `20260924143248_add_ssx_sync_checkpoints.sql`. `record_ssx_poll_error_v1` já permitia um dia. Alinhar esses contratos não introduz teto novo de histórico nem cadence. Suportar valores maiores que 24h exigiria decisão de produto e revisão dos contratos HTTP/checkpoint; essa opção não foi implementada.

A migração anterior das RPCs veio de `044bd498c1c8c45eeadd8b8ed033a9c606850423`. A origem do limite numérico do checkpoint está em `2eeb66f372c701575ca31b8c96ea2946039d416f`. Essas referências são fontes locais; não confirmam o contrato ativo de produção.

## Delta e segurança de aplicação

Novo forward gerado com `supabase migration new` (CLI 2.116.0, workdir scratch sem vínculo remoto): `20261006155532_align_ssx_cooldown_retry_after_contract.sql`.

São substituídos somente dois trechos de corpos PL/pgSQL conhecidos:

| RPC | Anterior | Corrigido |
| --- | --- | --- |
| account cooldown | `interval '1 hour'` | `interval '24 hours'` |
| unit backoff | `interval '1 day'` | `interval '24 hours'` |

`24 hours` representa 86.400 segundos decorridos em UTC e em transições DST. Um dia de calendário pode representar 23 ou 25 horas. A faixa SQL continua inclusiva de zero até 24h, com timestamps finitos, prazo não anterior à observação e observação no máximo cinco minutos no futuro. O prazo da conta é obrigatório; backoff nulo de unidade permanece permitido pelo contrato anterior. O handler continua usando piso 120s para `429` sem espera válida. Não há overflow de `Date` para o caminho limitado a 86.400s.

O parser preexistente continua limitando cabeçalhos numéricos maiores que 86.400 a 86.400; cabeçalho inválido/overflow não finito usa fallback 120. Esses comportamentos foram caracterizados, não alterados neste delta. O cooldown da conta preserva o maior prazo, portanto repetições válidas podem prolongá-lo conforme a observação; o limite é por observação, não um máximo agregado inventado.

A migração exige fingerprints exatos dos corpos (normalização apenas CRLF), assinatura, proprietário `postgres`, linguagem PL/pgSQL, security invoker, search_path vazio e ACL service-only. Corpo/metadata desconhecidos ou grants públicos abortam com `55000`. Repetição é idempotente. O DO é atômico: se a segunda função divergir, a alteração da primeira também volta. Advisory transaction lock e `lock_timeout=3s` limitam espera. Nenhum dado, grant, tabela ou configuração de polling é escrito pela migração.

O retorno guardado está em `ssx-account-cooldown-retry-after-rollback-2026-10-06.sql`. Restaura os limites anteriores sem apagar cooldown/backoff ativo. Atenção: o leitor antigo volta a rejeitar novas esperas >1h; preservar dados não resolve esse defeito funcional. Aplicar retorno somente com estratégia compatível das Edge Functions, nunca limpar um prazo ativo para acomodar código antigo.

## Evidências locais

Runtime: Node 22.16.0 / npm 10.9.4. Logs UTC e hashes finais no handoff independente em `task-2/ssx-doc-audit-20261006/sql-continuation`.

- 27 arquivos / **273 testes SSX e pipeline PASS**, incluindo 17 novos testes SQL e 13 do handler real + parser HTTP real + RPCs reais em PGlite. `fetch` é interceptado; middleware Cron/capability e transporte PostgREST são substituídos, e as permissões/capability SQL são verificadas diretamente.
- Script pipeline: **179 PASS / 1 skip preexistente** (permissões Linux em Windows), zero falhas.
- PostgreSQL nativo **17.6**, imagem cacheada imutável `sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518`: **12 grupos PASS**. Instância própria efêmera, network none, sem portas/mounts persistentes, tmpfs, limites de recursos, removida no finally. Dois pares de sessões com espera de lock observada comprovam máximo da conta e preservação de backoff mais recente contra escritor obsoleto.
- Casos: 3601/7200/86400s, 24h +1ms e 86401s, UTC/DST primavera/outono, HTTP-date >1h, inválido/overflow/zero/ausente funcional, timestamps infinitos/invertidos/futuros/nulos, tenant errado, capability desativada, ACL anon/authenticated, fingerprint/metadata divergente, repetição, retorno/reaplicação e recovery obsoleto. Erro não avança histórico, latest, sucesso do cursor ou queue.
- PASS: typecheck, lint de erros, lint de tipos críticos, lint dos quatro arquivos novos com zero warnings, quality baseline (99/113 any, nenhum arquivo novo >500 linhas), syntax das 102 Edge Functions, lockfile, repository hygiene, Supabase release contract e build/checks de bundle e segredo.
- O gate `supabase:baseline-candidate:check` da árvore desta frente retorna **FAIL esperado por inventário**, pois a entrada nova ainda não está no índice comum. A inclusão exata foi ensaiada em uma cópia própria com o **verificador original**: 27 forwards, 13 entradas suplementares anteriores preservadas e uma acrescentada, original manifest SHA256 `2d4a89c621ec1e036493db7dc75cd0bee1e9485e9bb68e0a552180d5d07e6bc0`, PASS. A cópia não é a árvore combinada; o índice de origem permaneceu byte-idêntico.

As fixtures SQL são **parciais**, com dez tabelas, PK/unique/defaults extraídos do baseline e dados sintéticos. Não comprovam Auth, RLS completa, PostgREST, Edge em Deno nem smoke UI da árvore final. Backoff da unidade conserva a regra anterior por `last_polled_at`: um erro mais novo pode substituir o prazo; a conta permanece monotônica. Não ampliar essa política neste ajuste de duração.

## Integração e promoção

O arquivo próprio `ssx-account-cooldown-retry-after-supplement-2026-10-06.json` entrega `reviewedForward` com versão/nome/SHA256 para o integrador **acrescentar** ao suplemento combinado, preservando todos os forwards já revisados. O índice comum não é propriedade desta frente; a ausência da entrada deve continuar bloqueando o gate fechado, sem relaxar validações.

Integrar primeiro `a1939926`, depois somente este delta. Repetir o gate de inventário no SHA combinado. Antes de qualquer promoção: confirmar contrato SQL ativo contra fingerprints, ensaiar forward/rollback no staging reservado pelo revisor, executar Quality gate completo (`validate`, todos os shards e `database-and-e2e`) e smoke do mesmo SHA/contrato. Migração verificada precede as Edge Functions; frontend sozinho não corrige essa incompatibilidade SQL. Nenhuma aplicação remota, enqueue, merge, push ou publicação foi executada nesta frente.
