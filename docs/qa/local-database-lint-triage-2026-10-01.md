# Triagem SQL atual — 01/10/2026

## Escopo e evidência

Banco local `agvlog-local-staging`, baseline privado aprovado mais 13forwards e
sete suplementos. Reexecução em 01/10 após 17:00 UTC com o comando CI intacto:

```sh
./node_modules/.bin/supabase db lint --local --workdir .local-staging \
  --network-id agvlog-local-staging-loopback --level error --fail-on error
```

**31 erros, exit 1.** O resultado bruto permanece privado em
`.execution-logs/sql-lint-final.private.json`; ACLs/chamadores foram consultados
em `BEGIN READ ONLY`, timeout de 15 s, sem registros de clientes. O modo warning
anterior retornava 181registros de função, não 181 erros. Nenhuma exclusão foi criada.
O [parecer de 28/09](local-database-lint-triage-2026-09-28.md) preserva a captura
original (35 erros); quatro caminhos ativos foram corrigidos pelos suplementos revisados
e testados nativamente. Esta análise não reescreve aquele histórico.

| Grupo | Quantidade | Prova e limite |
| --- | ---: | --- |
| APIs retidas incompatíveis |21| Assinaturas/ACLs atuais confirmadas; nenhuma chamada executável atual localizada; uso externo ainda desconhecido |
| FOREACH/SQL dinâmico |2| Loops exatos executados com fixtures sintéticas; não homologam o comando financeiro completo |
| Contexto SSX |2| Sem claim válido há recusa; com claim/header coerentes as RPCs alcançam o erro de domínio esperado |
| PostGIS |6| Contracasos nativos delimitados; nenhuma extensão ou função vendor alterada |
| Total |31| Gate continua bloqueado |

## APIs legadas: 21 assinaturas, 20 nomes

Todas negam `anon` e `authenticated`. Apenas
`add_driver_settlement_manual_expense` também nega `service_role`; as demais 20
assinaturas permitem esse papel. Ausência de chamada no repositório não autoriza
retirada nem prova que sejam inofensivas.

| Função pública | SQLSTATE / defeito observado | Chamador SQL lexical candidato |
| --- | --- | --- |
| add_driver_settlement_manual_expense |42703, driver_expenses.vehicle_id ausente | Nenhum |
| build_fiscal_documents_deleted_recovery_dry_run |42883, has_role(uuid,unknown) ausente | Nenhum |
| create_ledger_entry_v1 |42704, ledger_nature ausente | approve_financial_obligation_v1, também restrito ao serviço |
| create_load_v1 |42804, text usado como operation_type | Nenhum |
| create_load_with_next_number |42804, text usado como trip_id uuid | Nenhum |
| delete_load_v1 |42703, dispatch_trip_loads.trip_id ausente | Nenhum |
| diagnose_load_composition |42883, has_role ausente | repair_load_composition |
| driver_report_event_v1 |42703, dispatch_trips.start_km ausente | Nenhum |
| get_driver_workspace_v1 |42703, loads.total_value ausente | Nenhum |
| link_fiscal_documents_to_load_v1 |42883, has_role ausente | move_load_items_v2 |
| list_dispatch_trips_v1 |42703, trip_number ausente | Nenhum |
| list_drivers_v1 |42703, license_number ausente | Nenhum |
| log_operational_event_v2 |42883, digest(text,unknown) não resolvido | Nenhum |
| move_load_items_v2 |42883, has_role ausente | Nenhum |
| plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamptz,text) |42703, scheduled_start_at ausente | Nenhum |
| plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text) |42703, metadata ausente | Nenhum |
| process_geofence_alerts |42703, geofence_events.event_type ausente | Nenhum |
| process_overspeed_alerts |42P10, ON CONFLICT sem restrição correspondente | Nenhum |
| repair_load_composition |42883, has_role ausente | Nenhum |
| unlink_fiscal_documents_from_load_v1 |42883, has_role ausente | move_load_items_v2 |
| update_employee_v1 |42704, app_employee_status ausente | Nenhum |

Busca lexical nova em `src`, `scripts` e `supabase/functions`, separando testes,
fixtures e tipos gerados, não encontrou consumidores atuais dessas 21 assinaturas.
Busca em `pg_proc.prosrc` confirmou os quatro pares acima. SQL dinâmico e
chamadores fora do checkout podem escapar dessas buscas. O cron local foi
esvaziado na restauração; sua ausência não descreve produção.

Não se confirmou um novo defeito dessas 21 APIs em caminho atual executável da
aplicação. Reparar só o primeiro erro do lint pode revelar outros: converter
trip_id para UUID não decide a relação legada correta; recriar enums/has_role
pode mudar autorização; adicionar índice de overspeed exige contrato de
deduplicação; qualificar digest não valida o writer legado de POD nem seus
efeitos auditados. Não foram fabricados campos/types, stubs, grants, índices ou
migrations para fazer o lint compilar.

**Dados necessários para decidir:** inventário sanitizado de Edge/cron/webhooks
e clientes externos de serviço, nome da API/assinatura, owner, finalidade,
frequência agregada e versão do consumidor. Não solicitar tokens, payloads reais
ou dump de dados. Cada API precisa de decisão documentada: manter e reparar seu
contrato completo, migrar consumidores para o contrato atual, ou retirar depois
da ausência de consumidores ser demonstrada. Só então preparar um forward novo,
teste antes/depois com parâmetros válidos, isolamento, replay e estado obsoleto.

## Dez achados com contexto ou contracasos

| Função / quantidade | Resultado executado | Limite |
| --- | --- | --- |
| finance_private.legacy_integrity_inventory_revision |FOREACH percorre nomes individualmente; retorno executa | Não aprova toda a adoção legada |
| finance_private.unloading_projection_repair_context |SELECT dinâmico exato e 14 relações executam; função mantém finance_unloading_not_found para origem ausente | Não inventa origem/composição nem executa reparação financeira |
| resolve_ssx_mapping_conflict_v1/v2,2 |Recusam falta de claim; com contexto válido alcançam mapping_conflict_not_found | Não resolve um conflito real do provedor |
| extensions.postgis_full_version |Executa sem componente raster opcional | Não instala GDAL/raster |
| extensions.st_findextent,2 |Retornam BOX(0 0,1 1) em geometria temporária SRID 4326 | Só fixtures não vazias e as duas assinaturas testadas |
| extensions.addauth |Cria/usa tabela temporária necessária | Contexto de transação específico |
| extensions.lockrow |EnableLongTransactions inicializa; lock adquire e rejeita token concorrente | Prova serializável/rollback, não serviço externo |
| extensions.populate_geometry_columns |Infere Point SRID 4326 de tabela sintética | Apenas geometria testada |

Os primeiros sete casos estão em
`supabase/tests/database/03_contextual_lint_contracts.test.sql`; os três últimos
foram executados no projeto descartável de restauração, em transação
SERIALIZABLE/ROLLBACK, com logs privados. Não persistiram tabelas de locks ou
objetos de teste. [EnableLongTransactions](https://postgis.net/docs/manual-3.0/EnableLongTransactions.html)
e [AddAuth](https://postgis.net/docs/manual-3.0/AddAuth.html) documentam as
precondições usadas. Essas provas delimitam achados específicos e não retiram
o gate, não criam aprovação global de funções nem resolvem as 21 APIs legadas.

## Decisão

Manter 31 erros brutos/exit 1 como bloqueio. Contratos ativos corrigidos têm 175 testes nativos
aprovados e ensaio independente de baseline limpo/retorno; ambos permanecem
separados da dívida legada e da incompatibilidade de gastos de motorista.
Publicação depende de paridade atual do alvo, decisões de APIs e Quality gate
completo. READY de Vercel não confirma SQL/Edge nem operações.
