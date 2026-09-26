# Proposta de baseline verificável para CI e staging

**Estado em 26/09/2026, 20:20 UTC: proposta não executada.** Nenhum dump, baseline novo, staging ou alteração no banco foi criado por este plano. O histórico SQL aplicado permanece intacto. A decisão de promoção continua sujeita ao [roteiro de estabilidade](production-stability-playbook-2026-09-26.md) e ao [preflight de paridade](migration-parity-preflight-2026-09-26.md).

## Por que o replay atual não serve como gate

O [segundo Quality gate do PR #3](https://github.com/Centrialhub/agvlog/actions/runs/36267255499) parou em `20260830061800`. O [terceiro](https://github.com/Centrialhub/agvlog/actions/runs/36268506604) chegou a `20260830062933` e mostrou uma dependência circular: o preflight de 30/08 precisa de função/trigger criados só em `20260831230903`, enquanto a migração de 31/08 pressupõe sua ausência. O baseline existente, `20260824224152_baseline.sql`, descreve o catálogo de **24/08**, anterior a essas migrações. Alterar preflights já aplicados para fazer um banco vazio passar falsearia o histórico.

O ponto de corte proposto para um baseline **somente de teste** é o catálogo publicado depois de `20260924155758`, última versão live observada na auditoria (896 versões). Antes da captura, confirmar novamente o máximo e a contagem do ledger; se mudarem, suspender a geração e escolher outro corte. A versão do baseline de CI deve ficar **depois** desse corte e **antes** da primeira migração candidata `20260926183928`. Ela não entra em `supabase/migrations` do release nem no banco publicado.

## Fonte e montagem propostas

1. **Capturar o estado autoritativo.** Com DSN protegida e permissões de leitura, usar `supabase db dump --db-url <DSN> --file <artefato-restrito>` (schema somente é o padrão) ou `pg_dump --schema-only`. Registrar SHA-256 do arquivo, versão PostgreSQL, horário UTC e ledger antes/depois. O `pg_dump` obtém um snapshot consistente mesmo com uso concorrente. Examinar o SQL em área restrita: definições de funções podem conter literais sensíveis mesmo sem linhas de clientes. [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-db-dump), [PostgreSQL 17](https://www.postgresql.org/docs/17/app-pgdump.html).
2. **Completar o que o dump omite.** `supabase db dump` exclui schemas gerenciados, inclusive `auth` e `storage`, e por padrão não inclui dados nem papéis. Inventariar e reconstruir somente customizações do aplicativo: triggers em `auth.users`, políticas em `storage.objects`, buckets, publicações Realtime, event trigger `ensure_rls`, extensões, grants e privilégios padrão. Revisar cron e Vault separadamente; não copiar jobs, identificadores reais nem segredos de produção. O baseline de 24/08 já contém políticas de Storage e três buckets, mas está desatualizado e não pode ser usado como prova do estado de 24/09. [Limites do dump](https://supabase.com/docs/reference/cli/supabase-db-dump).
3. **Montar um workdir Supabase exclusivo de CI.** Preservar `supabase/migrations` original sem editar ou remover arquivos. Em um diretório separado, preparar `config.toml`, `functions/`, `tests/`, `seed.sql` e uma pasta `migrations/` com o baseline aprovado seguido **apenas dos 13 SQL de 26/09 listados abaixo**, copiados com SHA-256 idêntico aos arquivos do PR. Usar a opção global `--workdir` da CLI e comandos explicitamente `--local`; não vincular esse workdir à produção. Fixar em manifesto o SHA do PR, do baseline, dos complementos e dos 13 arquivos. Um baseline gerado automaticamente não pode substituir o arquivo versionado sem revisão. [Workdir e fluxo local](https://supabase.com/docs/guides/local-development/cli-workflows).
4. **Executar o gate completo no banco isolado.** Montar o workdir **antes** de `supabase start`; então executar `supabase db reset --local`, lint do banco, `supabase/verify/baseline_contract.sql`, `supabase test db` e Playwright com o mesmo banco. Manter a seed sintética: Supabase a executa após as migrações; o CI já define senha aleatória para as contas `.invalid`. O pgTAP `supabase/tests/database/01_release_security.test.sql` contém quatro expectativas AAL1/AAL2 de MFA aposentada nas linhas 793–827, incompatíveis com `20260831164442_remove_authenticator_requirement.sql` e com `baseline_contract.sql`; revisar essas expectativas para o contrato publicado antes de exigir pgTAP verde. [Ordem de seed e reset](https://supabase.com/docs/guides/local-development/seeding-your-database).
5. **Provar a equivalência relevante.** Comparar catálogo antes/depois em ambiente isolado: assinaturas e `EXECUTE` das RPCs, RLS/políticas, grants, funções, triggers, constraints e comportamento dos fluxos críticos. O baseline deve reproduzir o estado **anterior** ao PR; os 13 forwards devem levar ao contrato candidato. Bloquear o gate se a fonte live mudar, se algum arquivo copiado divergir ou se faltar customização do catálogo.

Os **13 forwards posteriores ao corte** presentes no worktree, em ordem:

```text
20260926183928_restore_portal_list_contracts.sql
20260926184015_restrict_incident_personnel_reads.sql
20260926185847_enforce_fiscal_document_load_tenant.sql
20260926185848_restore_fiscal_freight_rpcs.sql
20260926190513_restore_address_candidate_recording_rpc.sql
20260926190732_restore_inventory_public_rpcs.sql
20260926190733_restore_team_access_public_rpcs.sql
20260926191248_restore_portal_occurrence_command_rpcs.sql
20260926191257_restore_ssx_mapping_conflict_review_rpcs.sql
20260926191456_restore_client_mdfe_documents_v1.sql
20260926191500_restore_delete_load_item_v4.sql
20260926191625_restore_operator_route_reader.sql
20260926191630_restore_productivity_report_reader.sql
```

## Limite do baseline e ensaio de promoção

Um projeto staging vazio com esse baseline valida instalação limpa, seed e testes end to end; **não comprova** a atualização incremental do banco publicado. Para esta decisão, usar um clone isolado do **schema e ledger** live, sem dados de clientes, e ensaiar somente os SQL forward após reconciliar as 440 versões remote-only, 560 locais retroativas e 413 aliases. Conferir especialmente o grant de geofence restaurado em 24/09. A promoção de produção continua bloqueada pelo preflight de paridade; o baseline de CI jamais é executado nela. Branches Supabase herdam o histórico do projeto de origem, portanto não eliminam essa reconciliação. [Comportamento das branches](https://supabase.com/docs/guides/deployment/branching/working-with-branches).

Não usar `supabase db reset --linked` para validar esta proposta: ele apaga e recria o banco remoto vinculado. Não usar `migration squash` como atalho: a CLI reescreve por padrão o arquivo mais recente e omite DML, inclusive buckets, cron e Vault. `db pull` no checkout atual construiria um shadow com replay inválido e pode registrar uma nova versão no ledger remoto; para a captura somente de leitura, preferir dump. [Reset remoto](https://supabase.com/docs/guides/local-development/cli-workflows), [squash](https://supabase.com/docs/reference/cli/supabase-migration-squash).

## Entradas ainda necessárias

- DSN protegida com leitura suficiente para dump completo, inventário de customizações e conferência do ledger; não há `AGVLOG_RELEASE_DB_URL` neste host.
- Confirmação do ponto de corte no live, versão do PostgreSQL, inventário de schemas/extensões e revisão sanitária do artefato por responsável de banco.
- Complementos SQL para objetos excluídos do dump e decisões sobre buckets, Realtime, cron, Vault e integrações externas em CI/staging.
- Implementação e revisão do workdir/manifesto de CI, ajuste das expectativas pgTAP de MFA e execução completa de reset, lint, contrato, pgTAP e E2E.
- Staging isolado com dados sintéticos, autenticação e Preview apontando para ele; ensaio incremental em clone do ledger publicado e plano revisado de reconciliação antes de qualquer SQL em produção.
