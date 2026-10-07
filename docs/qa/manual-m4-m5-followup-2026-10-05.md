# Correções M4/M5 sobre o candidato 8f385ba7

Tarefa atribuída: `manual-native-followup-20261005`, dono `CodexMerge`, worktree `F:/AGVLOG/work/manual-native-followup-20261005`. Base: `8f385ba7a303fe24aae6caa75646090d48a6475d`, árvore `fbd125f8d89aa899e292da62806a5b9ed6ee2b71`. A fonte `manual-driver-access-20261005` permanece congelada e os serviços UI4184/API57327 pertencem exclusivamente ao revisor. Não houve alteração da réplica, serviços, contas reais ou publicação por esta tarefa.

## Diagnóstico e escopo

M4: a consulta de disponibilidade mantinha o cache após falha; `isFetching` retornava false e liberava juntar/separar. Checkbox e atribuições também usavam um bloqueio incompleto. A correção faz pendência, atualização e erro bloquearem toda edição/criação, mostra erro com retry real e mantém plano/seleções/atribuições. Recuperação de comando já persistido continua disponível com o mesmo UUID/payload, independentemente da disponibilidade atual.

M5: o teste anterior de INSERT SQL já fornecia `raw_app_meta_data` completo. GoTrue v2.196.0 inicializa apenas provider/providers, executa INSERT e seus triggers e somente depois aplica `params.AppMetaData`, dentro da mesma transação. O protocolo real falhava com `driver_accounts_require_username_creation`. Fonte primária: https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go#L437-L504. A reprodução SQL da ordem do GoTrue é um modelo isolado; não equivale a executar o servidor Auth nativo.

A correção deriva a identificação de motorista do registro privado de convite validado, antes do INSERT de Auth e dos writes de membership. Conserva SHA-256 de nonce, validade, lock/consumo único da reserva, tenant, papel driver, admin ativo e cadastro ativo ainda sem UID. Os dados auto declarados de `user_metadata` não autorizam acesso. Convites normais de operador/cliente continuam no seu fluxo. Não se desabilitam triggers nem se afrouxam os guards de conta aposentada, empresa, papel ou vínculo.

O forward é incremental: treze originais e onze suplementos do SHA8f permanecem byte-idênticos; o novo suplemento é gerado pelo Supabase CLI fixado no lockfile e acrescentado ao manifesto somente com o hash final. Em banco já atualizado a8f, aplicar somente esse novo forward; em banco novo, aplicar o conjunto ordenado de13+12 após restauração validada. Não reaplicar o primeiro forward M5, que já criou sua coluna/contrato.

As funções de sincronização originais não são alteradas. O catálogo nativo publicado em `task-3/8f-backend-before/catalog-before.json` confirma hashes `3b05db0b8a1eb30ca63e13047c593118` e `e41ac02a0164e958e93a552d546dba65`; elas têm proteção por profundidade de trigger. Revalidar esse catálogo atual e a criação em workspace com duas empresas na homologação. Um contexto de erro isolado não substitui a comparação de definição/hash do grafo completo.

## Evidências e limites

Preservação: `preservation/frozen-8f.json` captura os45 caminhos da entrega8f e os24 forwards existentes. `preservation/manifest.json` mantém o snapshot dos32 caminhos da fonte manual de Thomaz. O recheck antes do commit compara bytes, SHA/status e a base cumulativa.

M4 possui regressões com QueryClient, Supabase SDK, paginação, outbox e serialização RPC reais sobre transporte HTTP sintético: cache com erro, retry retido e sucesso sem perda do plano; consulta inicial pendente; recuperação de pedido incerto com UUID/payload idênticos durante erro de disponibilidade. Controles de layout/select e catálogos de atribuição são fixtures.

M5 possui fixture PostgreSQL em memória com pgcrypto real e predecessores/triggers revisados, incluindo a ordem INSERT/triggers/updateAppMetaData. Exercitar sucesso, rollback integral, nonce/replay/expiração, admin revogado, driver indisponível, empresa diferente, convite normal de operador/cliente e identidade/ACL dos objetos preservados. PostgreSQL em memória não valida concorrência nativa, GoTrue HTTP, sessões/JWT antigos, PostgREST, RLS ou Storage completos.

Os resultados executados são registrados em `handoff/candidate.json` e `local-checks.json`, vinculados ao SHA/tree exatos; nenhum passe de8f/fbef ou de outro SHA é herdado. O checkpoint histórico informado às23:07UTC sobre8f era1 aprovado(M1),2 falhos(M4/M5),16 pendentes. Ele não aprova o novo candidato.

## Aceite combinado e entrega

Os19 objetivos permanecem pendentes no novo SHA: M1–M4, A1–A9, H1–H3, A13, A14 e M5. A liberação depende da identidade conjunta de frontend, Edge Functions, ledger e catálogo de banco, gates completos e repetição dos casos nativos aplicáveis. READY de hospedagem não valida esses fluxos.

Prioridade nativa: M4 falha após os retries reais, tentativa de unir/separar/selecionar/atribuir/criar bloqueada, retry retido/sucesso preserva o plano e recovery preserva UUID; M5 criação pelo endpoint→GoTrue Admin HTTP→triggers→readback/login, isolamento tenant/admin, replay/concurrency, duas empresas no mesmo workspace, legado/aposentadoria e sessão antiga. Não criar sucesso inserindo metadados prontos por SQL nem desligar proteções para preparar fixture.

O revisor deve conferir SHA/tree, hash do novo forward e predecessor/OID/owner/ACL/config/triggers atuais antes de aplicar na réplica exclusivamente sob sua coordenação. Completar shards unitários, DB/E2E, CI hospedado, providers fiscais/SSX autorizados e retorno de frontend/Edge/banco/Auth. Conservar o reader v2 do outbox no rollback; soft-delete/recriação não restaura UID/credenciais antigos. Resolver/preservar filas sob o UID original antes de qualquer retirada real.

Sem enqueue/integrate, commit final de release, push, merge remoto, migration produtiva ou deploy nesta tarefa. Esses passos dependem do aceite combinado e da autorização de publicação. A base cumulativa permanece `integration/local` emdeda6fd1, com pin publicado63278f7 preservado.

Novo forward CLI: 20261005233405_derive_driver_metadata_before_auth_insert.sql, SHA256 d2449885d3a0b5d0a4b7f8c5fd0715599dc190364027469869f121c937b8e5db. Predecessor prosrc f7f4349038197d33f7edcc77fcf10749; pós-condição fe9013b16fc8a550e293c717263c9fa8. OID/owner/ACL/config e demais objetos/triggers protegidos são comparados antes/depois; drift interrompe aplicação.
