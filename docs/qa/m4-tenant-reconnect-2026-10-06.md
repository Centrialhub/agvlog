# M4 — plano de agrupamento e reconexão de empresa

Base:98744858c96f314612c7800f233e3f8f285d65a5, tree0274162a9c0baadc7ffe9206219621fff55d13a6. Correção autorizada no checkout separado assigned-personnel-followup-20261006/CodexMerge. A fonte987 servida pelo revisor em UI4186/API57351, fontes anteriores, manual-updates e task-2 permanecem protegidas. A6 já aprovado na base e fora do delta. Nenhuma migration nova:13forwards originais+13suplementares e ambos manifests preservados byte a byte.

## Evidência e causa

O revisor reproduziu em Chromium autenticado nativo a união MG–Brasília+MG–Pirapora com Sem veículo/Sem motorista. Offline fechou o diálogo; online e refetch concluído mostraram dois grupos separados, com zero create_grouped_load_v1. Evidências originais:task-3/987-M4-NATIVE-BLOCKER.md,987-m4-reconnect-plan-loss-confirmed-native.json e987-browser-results-M4-network-plan-loss-confirmed-current-native.json. O contador anterior à conclusão de query não foi tratado como prova de separação.

A regressão local integrada reproduziu o mesmo desaparecimento do diálogo no provider anterior, sem fake clock ou injeção de query.data. A chave current-tenant-memberships incluía online/offline e gcTime0. Ao mudar de chave, a query nova perdia data, a query offline podia ficar pausada pelo networkMode padrão, memberships/tenant/role ficavam vazios e TenantDataBoundary recebia outro key. Isso destruía groupingOpen e a combinação. AuthProvider já preservava mesma identidade em TOKEN_REFRESHED; seu reset real de conta não foi removido.

## Alteração

useTenant mantém a chave de membership por actor. networkMode always permite o caminho local de cache quando offline; a queryFn consulta RPC somente quando online. Um efeito revalida explicitamente em mudança de conectividade/token; refetchOnReconnect false evita um segundo mecanismo concorrente nessa consulta. A leitura offline continua verificando actor/versão/TTL de7dias, sem renovar o prazo do cache. Refetch pendente mantém a identidade confirmada; erro de revalidação continua ocultando as permissões e desmontando dados anteriores.

TenantDataBoundary permanece identificado por usuário/empresa/papel. Troca real de contexto, logout, downgrade ou revogação descartam o plano. Cancelar/reabrir desfaz a combinação e refaz a seleção; o contrato anterior das atribuições de motorista/veículo não foi ampliado.

AbortSignal é conferido antes de salvar membership remoto, impedindo repovoamento do cache antigo por transporte que ignora cancelamento. Montagem, revisão e identidade/papel invalidam continuações de sincronização/ativação substituídas. Respostas tardias não restauram header/contexto antigo nem iniciam cancelamento de queries, canais, RPC ou rollback na conta seguinte. TOKEN_REFRESHED do switch legítimo continua válido, inclusive quando a empresa de destino tem papel diferente: operator/driver/owner são testados. O guard distingue o papel confirmado do destino planejado de downgrade/revogação no contexto de origem.

Nenhum formato de outbox, UUID, payload, idempotência ou writer foi modificado. A transição de rede não dispara create/recover. A regressão usa useLoadCreation/outbox reais e confirma recuperação explícita online do UUID/payload originais; a idempotência do servidor permanece dependente da homologação nativa.

## Validação e limites

Testes integrados usam AuthProvider, TenantProvider, useOnlineStatus, TenantDataBoundary, PendingDocsGrouping, componentes UI, SDK PostgREST/paginação e useLoadCreation reais. Somente transporte/Auth SDK e3lookup hooks de dados fixos são controlados. Eventos offline/online são reais dentro do DOM; onlineManager é resetado apenas entre testes independentes. Fixtures PGlite são locais/em memória e não executam contra réplica/produção. Testes de estado não equivalem a GoTrue/Chromium autenticado ou concorrência nativa.

Casos: união+Sem veículo/Sem motorista em offline/online e refetch pendente/concluído; refresh token; mudanças de usuário/empresa/papel/logout; revalidação negada e retry sem restaurar plano; cache expirado ao ir offline; aborto/late response sem cache antigo; cancel/reopen; UUID/payload em falha incerta, reconexão sem comandos e recovery explícito. Fixtures adicionais cobrem JWT sintético active_tenant_id, StrictMode, refresh pré-switch/pós-commit tardio e synchronizer desmontado.

Limitações anteriores preservadas: TTL é validado em cada leitura do cache/edge/refetch, sem timer que feche a UI ao completar7dias continuamente offline. Cada comando sincronizado continua autorizado pelo servidor. useLoadCreation não ganhou guard novo para clique manual offline; teste não confunde tentativa de transporte com comando entregue. Lock/storage/reload em Chromium local não comprovam UI autenticada nativa.

O manifesto do handoff registra resultados e logs do SHA/tree final. Passes da base987, inclusive gate7776+1skip e A6, não são herdados como aprovação deste novo SHA. Gate completo/CI e os19objetivos nativos permanecem pendentes no sucessor; os11pendentes anteriores podem continuar separadamente na fonte987 preservada.

## Reteste nativo e entrega

Preparar outra fonte servida isolada no novo SHA, reutilizando somente baseline de réplica autorizado pelo revisor; não aplicar SQL adicional para esta correção frontend. Repetir M4 na UI real: unir os dois destinos, escolher explícitos Sem veículo/Sem motorista, alternar o contexto de rede offline/online, aguardar memberships e disponibilidade realmente concluírem e comparar mesma união/dialog/seleções, com zero create_grouped_load_v1. Cobrir refresh token, troca real de usuário/empresa/papel, logout, erro de acesso, cancelamento e outbox/UUID. Verificar A6 fora do delta e26forwards/manifests byte-idênticos.

Nenhum enqueue/integrate, commit final de release, push, migration compartilhada/produtiva, deploy, alteração de serviços do revisor ou conta real foi executado. Publicação depende de aprovação do SHA combinado, backup/catalog/preflight/rollback e autorização posterior. Retornar ao artefato frontend anterior preservado se M4/isolamento falhar; este delta não exige rollback de banco. Não reescrever commits ou desfazer manualmente a task2.
