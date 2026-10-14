# Parada Native: permissão do normalizador de texto

Task `native-stop-helper-fix-20261014`, owner `CodexNativeStopHelper`, base congelada `b9ad8dab41d0cdebee60d6b96c8903584a68f68d`. Fonte preservada em `F:/AGVLOG/work/native-driver-crlf-ci-forward-fix-20261014`; correção em worktree próprio. Reserva e `check` PASS antes das edições/testes. Migração nova gerada pelo coordenador com Supabase CLI 2.116.0: `20261014062118_native_dispatch_stop_helper_execute.sql`.

## Falha e causa verificadas

A evidência `native-operational-handoff-20261014/NATIVE-DISPATCH-STOP-PERMISSION-DIAGNOSTIC.json` reproduziu `42501 / permission denied for function normalized_address_text` em `private.apply_verified_client_geocode_to_stop()` linha 9, sem parada commitada. O trigger é `SECURITY INVOKER`; sua consulta a clientes usa o ator autenticado e RLS. A chamada aninhada ao helper também usa esse ator, mas a ACL observada era somente `{postgres=X/postgres}`.

`private.normalized_address_text(text)` é uma função SQL `IMMUTABLE`, `SECURITY INVOKER`, owner `postgres`, `search_path=""`, corpo MD5 `0a2360738d481c4e9edf4a8be45c0c43`. Executa apenas `lower(regexp_replace(btrim(coalesce(_address,'')),'\s+',' ','g'))`, sem leitura de tabelas, Auth, Storage ou dados de outro tenant.

## Delta e fronteiras

O forward concede `EXECUTE` somente nesse helper a `authenticated`, sem grant option. Um único `DO` valida previamente identidade, owner, linguagem, retorno, invoker, imutabilidade, configuração e hash do corpo; rejeita privilégio inesperado de `anon`/`service_role` ou delegação por `authenticated`. O comando é atômico e idempotente. O corpo da função, o trigger, sua ACL, tabelas, políticas RLS, grants de schema e modos de execução permanecem intactos. O helper não se torna RPC pública.

SHA256 do forward: `220233cb4d54a3685290bc6eb2a81c4ddaef34b75ebc52c5337b6727923dd902`. SHA256 do teste: `c863311cff941362e9a0b4f13378aa1bed516c43100d28460202ebe92ca08f0f`. Inclusão desse forward no manifesto suplementar pertence à composição coordenada, fora deste delta de três caminhos.

## QA associada

Em 2026-10-14, 06:28:36–06:28:41 UTC: ownership PASS; uma suíte PGlite com 9 testes PASS, zero falhas/skips; lint do teste PASS; contrato Supabase release PASS (759 migrations ordenadas, 50 funções Edge). Node Windows 22.23.2 absoluto, PGlite 0.5.8 e Vitest 4.1.11. Dependências copiadas para a própria task; lock origem/destino SHA256 `1b1bbf3972ac1ab07701129db51724a2ca7eb3bc918f9a72081e50c8e65e788d`; caches e diretório de env exclusivos. Não houve WSL, container, banco compartilhado, Native, SSX ou produção neste trabalho.

Os testes executam as duas funções originais extraídas do SQL histórico, com tabelas mínimas e políticas sintéticas de tenant. Cobrem: `42501` anterior com zero insert; grant específico e definições/RLS preservadas; normalização null/whitespace; insert e update persistidos com cliente verificado; cliente de outro tenant invisível e insert em outro tenant recusado; `anon`/`service_role` negados; repetição sem mudar ACL; compensação específica; corpo desconhecido recusado antes do grant.

Artefatos locais: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/native-stop-helper-fix-20261014/ASSOCIATED-GATES-1791959321294.json`, `regressions-1791959316352.json`, `DEPENDENCY-QUALIFICATION.json`. Os recibos anteriores preservam o PATH incompleto do harness e o lint inicial, corrigidos antes do replay final. O PASS PGlite não aprova os demais triggers/policies do catálogo Native; o executor exclusivo ainda deve aplicar o forward revisado e retestar criação/atualização da parada pela UI/PostgREST, persistência e isolamento em duas transportadoras, no SHA combinado.

## Compensação e entrega

Compensação específica, após conferir definição/ACL e autorizar seu uso: `REVOKE EXECUTE ON FUNCTION private.normalized_address_text(text) FROM authenticated;`. Não restaura dados nem remove paradas já criadas; recoloca o bloqueio conhecido de `42501`. Foi ensaiada na fixture, seguida da reaplicação do forward. Uma troca de frontend não desfaz esse grant.

Commit/freeze, integração do manifesto, árvore combinada e ensaio Native pertencem ao coordenador. Este trabalho não integra, publica, altera a fonte congelada nem qualifica produção.
