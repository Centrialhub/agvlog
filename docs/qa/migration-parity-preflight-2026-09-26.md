# Verificação da paridade de migrações antes da publicação

O checkout `origin/main` de 23/09 não representa, sozinho, o histórico do banco publicado. Na primeira comparação de 26/09, o banco tinha 896 versões aplicadas; após reconciliar os sete hotfixes de 24/09, o worktree tinha 724 arquivos SQL. Só 158 versões coincidiam. Havia 413 nomes de migração presentes com timestamps diferentes, o que indica possível equivalência, mas o nome não prova que os corpos SQL sejam iguais. O número de arquivos locais aumenta à medida que as correções candidatas são criadas. O [roteiro de estabilidade](production-stability-playbook-2026-09-26.md) contém os gates de promoção, e o [log](production-stability-log-2026-09-26.md) acompanha o estado desta rodada.

## Bloqueio concreto: geofence

`20260916152615_finalize_geofence_automation.sql` está no checkout, mas o banco registra `finalize_geofence_automation` sob `20260916153300`. O arquivo local revoga `EXECUTE` de `service_role` na função `private.sync_fleet_geofences_for_canonical_v1`. O hotfix `20260924124326_grant_address_geofence_sync_to_service_role` concedeu esse acesso em produção e já está marcado como aplicado. Se a versão local antiga for executada agora, o hotfix não será executado outra vez, e a fila de geocoding/geofence perderá acesso à função.

`20260922039000_make_poi_dedupe_conflict_inferable.sql` é byte a byte igual ao SQL de `20260924124337_make_poi_dedupe_conflict_inferable.sql`, aplicado em produção. O replay repetiria `DROP INDEX` e `CREATE UNIQUE INDEX`, possivelmente bloqueando gravações enquanto reconstrói o índice. Esses dois exemplos exigem reconciliação de versões antes de um `db push`.

## Preflight obrigatório para o job de release

Configure `AGVLOG_RELEASE_DB_URL` como segredo do ambiente protegido e execute `npm run supabase:parity:check` imediatamente antes de qualquer `supabase db push` ou replay. O script consulta somente `supabase_migrations.schema_migrations`, com a sessão Postgres em modo somente leitura. Ele falha quando encontra versões locais retroativas, versões remotas ausentes no checkout, mesmo nome sob versões diferentes ou nomes diferentes sob a mesma versão. Migrações locais futuras, com versão acima da última aplicada, são permitidas.

Também é possível testar uma exportação JSON de `{ "migrations": [{ "version": "...", "name": "..." }] }` com `npm run supabase:parity:check -- --remote-history <arquivo.json>`. Essa opção serve para revisão e testes; o release deve consultar o banco alvo no momento da promoção.

O workflow `release-candidate` usa Supabase de staging, mas ainda não tem uma URL Postgres configurada para executar esse preflight. O job de promoção à produção deve usar o segredo da base de produção e depender do resultado zero dessa checagem. Não automatizar `migration repair` nem reaplicar arquivos históricos até confirmar equivalência dos corpos SQL e efeitos publicados.
