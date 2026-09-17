# Lote operacional33 — estado final da revisão local

2026-09-11. Nenhuma aplicação remota realizada por este agente.

## Histórico observado e ordem

SELECT em MAINDB às03:23:59 UTC confirmou30/33 aplicadas; ausentes211000,211200,213021. Essa é observação naquele instante, não afirmação de estado atual. O coordenador deve repetir os SELECT antes de aplicar. Não reaplicar as30 anteriores. A diferença local204500 já aplicada exige rastrear sua revisão, não reaplicá-la.

Ordem proposta: rollout32601 (incorpora211000 com compatibilidade e reauth),211200,213021. Não aplicar também211000 original sobre32601. As duas últimas mantêm os hashes originais. Fontes adicionais211800/213156/220847 pertencem à ordem financeira/operacional do coordenador e não estão implicitamente aprovadas aqui.

## Compatibilidade de políticas

A pós-condição antiga211000 falhava ao encontrar sete políticas MAINDB pré-existentes: três restrictive agvlog_active_tenant_context (geofences/geofence_radius_policies/address_resolution_queue) e quatro permissivas agvlog_*_authenticated em geofences. A variante32601 verifica seus hashes/roles/comando/permissividade/RLS antes e depois, preserva todas e as exclui somente das duas verificações textuais/contagem das nove políticas próprias. Restrictive por AND mantém isolamento da empresa. Mudança de contrato ou política extra desconhecida continua abortando. Nenhuma policy foi removida para satisfazer uma contagem.

## Efeitos de211200/213021

211200 adiciona conflito fiscal e locks, preserva o writer anterior sob alias e exige snapshot fiscal capturado pelo motorista. Não emite documento fiscal.213021 preserva uploads de conflitos descartados, publica DTOs sanitizados/decisão discard, exige novo pedido para nova tentativa e aposenta dois adaptersservice com55000. A aplicação depende do frontend/outbox compatível. Não altera custos/acertos/obrigações.

Pré-requisitos de presença foram consultados em MAINDB03:31:38 UTC: schemasdelivery_private/storage_evidence_private, relações do grafo/retention, writer e helpers presentes. Verificação executável atual está em driver-lot33-final-preflight.sql: produzir evidência antes de211200 e repetir depois dela para213021. Os SELECT não substituem guardas inline nem atestam toda a cadeia operacional.

## Complemento de 11/09: autorização depois das esperas e grafo executado

A variante32601 foi atualizada antes de aplicação. SHA256 final: `582e7d61c72814e0bbfbc2c0be25aea092855fd47e4d3b31ae18d80e4daaf918`. A original para instalações novas211000 recebeu a mesma reautorização, SHA256 `d3038bef7ce0bd818e9d7c97f5beab63de8daa97c2a315508685d5a0f49dfdee`; o arquivo anterior foi preservado em `20260910211000_canonical_destination_geocoding_idempotency.pre-reauth.sql`. Os sete contratos de políticas preservados e a correção restrita de pós-condição não mudaram.

Problema confirmado por leitura dos corpos anteriores: `resolve_address_queue_item_v2`, `upsert_geofence_v4` e `review_trip_cargo_divergence_v2` verificavam acesso antes da espera advisory e devolviam replay sem nova consulta à associação. A resolução de endereço também podia prosseguir depois da espera na linha da fila. Agora os três verificam novamente auth.uid, empresa ativa, associação atual e papel permitido após advisory e antes de replay; a resolução também verifica depois do FOR UPDATE da fila. Todos verificam novamente antes de inserir o resultado durável, de modo que revogação observada depois de esperas em delegates/UPDATE cause rollback da operação inteira. Não há bypass administrativo novo.

`canonicalCompanyPolicyCompatibility.test.ts`: quatro provas PGlite passaram (00:41 local), incluindo instalação completa/políticas, empresa ativa/RLS/resolução/replay, revogação real entre chamadas e inspeção da posição das checagens após esperas. Esse último é teste de contrato, NÃO demonstra interleaving concorrente. Suplemento PostgreSQL nativo solicitado ao agente dono do runtime e ainda não executado.

`driverNfseOnlyDeliveryWriterDatabase.test.ts`: seis provas PGlite passaram em 00:42:30 local. A fixture passou a executar os corpos de produção de `_assert_driver_owns_trip`, `_lock_delivery_trip_graph`, `_lock_driver_delivery_stop`, `_delivery_result_from_statuses`, `_derive_driver_delivery_result`, `_prepare_delivery_proof`, `_delivery_items_for_stop`, `driver_create_operational_occurrence` e `is_tenant_operator_or_admin`. Foram removidos os retornos de sucesso simulados desses helpers. As provas cobrem entrega NFS-e/canhoto/replay, carga realmente delivered e viagem completed, motorista revogado, conflito NF-e/NFS-e e decisão auditada, adapters retirados e campos fiscais protegidos.211200 e213021 foram executadas integralmente e permaneceram sem alterações.

Hashes:211200 `c66ac6bc9eb42963bf7bf38ef723b5d4b4bb818146156f95d013f861ad436ddd`;213021 `a7f723b4169fb7f5f85b3e21011bb789b6053904ccedc1e67ae745f99d1bda36`.

Limites da fixture de entregas: DDL relacional reduzido, view de alocação simplificada com campos/joins necessários, adaptador local de claims e tabela de auditoria reduzida com INSERT persistido. Não é instalação integral do MAINDB, prova de RLS de todas as tabelas, PostGIS, browser ou autenticação criptográfica. O cenário de conflito remove o vínculo diretamente na fixture; não simula comando de reentrega completo. A integração acima não emite novos documentos fiscais.

Lint dos dois arquivos passou. Nenhum TSC, serviço PostgreSQL, chamada de aplicação remota ou edição Sites foi executado nesta rodada.

