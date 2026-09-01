# Auditoria de ACL de funções `SECURITY DEFINER`

Escopo: catálogo somente leitura do projeto `qcvnsdrbcchaxvawcngk`, HEAD local e
SHA publicado `9efaf13705a0fedb08f80cf5a20d99ead2ba51fd`. Nenhuma alteração foi feita
no banco, Auth, Edge Functions ou provedores fiscais.

## Resultado do catálogo

- 130 assinaturas em `public` são `SECURITY DEFINER` e executáveis por
  `authenticated` por grant explícito.
- Nenhuma das 130 herda `EXECUTE` de `PUBLIC` e nenhuma é executável por
  `anon`.
- `search_path`: 25 vazio, 101 `public` e 4 `pg_catalog, public`; nenhuma está
  sem configuração.
- 77 corpos têm marcador explícito do ator, 92 têm verificação de tenant/papel
  e 21 têm `FOR UPDATE` ou advisory lock. Esses números são sinais estáticos,
  não prova isolada de autorização ou segurança concorrente.
- 119 preservam `service_role`; 9 são dependências diretas de políticas RLS.

A consulta de inventário usada foi por OID/assinatura e registrou, para cada
função: ACL efetiva, `proconfig`, hash do corpo, marcadores de ator/tenant,
locks e dependências de política. O linter deve ser reexecutado após deploy.

## Dependências RLS — preservar `EXECUTE`

| Assinatura | Caller | Decisão |
| --- | --- | --- |
| `current_driver_id(uuid)` | políticas + SQL interno | preservar |
| `driver_owns_trip(uuid)` | políticas de viagem/alerta | preservar |
| `get_user_tenant_ids()` | políticas multi-tenant | preservar |
| `has_tenant_role(uuid,app_role)` | políticas operacionais | preservar |
| `is_tenant_admin(uuid)` | políticas administrativas | preservar |
| `is_tenant_member(uuid)` | políticas e storage | preservar |
| `is_tenant_operator_or_admin(uuid)` | políticas + Edge autenticada | preservar |
| `is_user_internal_role(uuid)` | políticas operacionais | preservar |
| `portal_user_can_access_fiscal_document(uuid,uuid)` | política fiscal | preservar |

## Assinaturas sem caller runtime direto no HEAD e no SHA publicado

| Assinatura | Controle observado | Classificação |
| --- | --- | --- |
| `add_driver_settlement_adjustment(uuid,text,numeric,text,text)` | ator + tenant; `search_path=public` | legado, corte depende da command RPC |
| `add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)` | tenant + lock; `search_path=public` | legado, corte depende da command RPC |
| `cancel_client_invoice(uuid,text)` | tenant; `search_path=public` | legado, corte coordenado |
| `cancel_closing_report(uuid,text)` | ator + tenant; `search_path=public` | legado, corte coordenado |
| `close_closing_report(uuid)` | ator + tenant; `search_path=public` | legado, corte coordenado |
| `create_client_invoice(jsonb)` | ator + tenant; `search_path=pg_catalog, public` | legado, corte coordenado |
| `driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)` | sem marcador estático de ator/tenant; `search_path=public` | legado; não cortar antes da nova command RPC |
| `driver_finalize_delivery(uuid,text,text,text[],text,text,text)` | wrapper de compatibilidade; `search_path=''` | preservar no cutover do motorista |
| `driver_update_stop_status(uuid,text,text)` | wrapper de compatibilidade; `search_path=''` | preservar no cutover do motorista |
| `generate_client_invoice_from_closing(uuid)` | ator + tenant + lock; `search_path=pg_catalog, public` | legado, corte coordenado |
| `get_tenant_integration_capabilities_v1(uuid)` | ator + tenant; `search_path=''` | API pública reservada |
| `next_closing_report_number(uuid,date)` | tenant; `search_path=pg_catalog, public` | helper do fluxo legado |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)` | tenant, sem lock; `search_path=public` | revogar de browser neste lote |
| `plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb)` | ator + tenant + lock; `search_path=public` | API canônica, preservar |
| `register_closing_report_payment(uuid,jsonb)` | ator + tenant + lock; `search_path=pg_catalog, public` | legado, corte coordenado |
| `register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text)` | ator + tenant; `search_path=public` | legado, corte coordenado |
| `remove_driver_settlement_adjustment(uuid,uuid,text)` | tenant; `search_path=public` | legado, corte depende da command RPC |
| `reopen_closing_report(uuid,text)` | ator + tenant; `search_path=public` | legado, corte coordenado |
| `reverse_receivable_payment(uuid)` | ator + tenant; `search_path=public` | legado, corte coordenado |
| `upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)` | tenant + lock; `search_path=public` | API de compatibilidade/teste E2E, preservar |

As nove dependências RLS acima também não têm caller TypeScript direto em
alguns casos, mas não são órfãs. Os demais nomes inicialmente sem ocorrência
literal foram resolvidos como helpers de política, callers indiretos ou
wrappers canônicos/compatíveis. Revogação por ausência de string seria
incorreta.

## Lote conservador

Somente a assinatura de sete argumentos de `plan_dispatch_trip_v2` foi
selecionada. Evidências:

- zero caller no frontend atual, Edge Functions e SHA publicado;
- zero dependência de política, view ou trigger no catálogo;
- corpo de produção identificado por hash `14a016666f3beecff0b49e7b30b12632`;
- substitutos `dispatch_planned_route(jsonb)` e `plan_dispatch_trip_v3(...)`
  existem e são executáveis por `authenticated` em produção;
- o outro overload v2 já não é executável por `authenticated`;
- `service_role` é preservado para compatibilidade de backend.

A migration é forward-only, valida corpo/ACL/dependências e substitutos antes
da revogação e valida o resultado depois. Não há revogação por nome, loop sobre
catálogo, `ALTER DEFAULT PRIVILEGES` nem revogação em massa.

## Restante

As 14 funções da migration anterior
`20260901003429_close_remaining_legacy_security_definer_acl.sql` continuam
dependentes do rollout conjunto das command RPCs e não foram duplicadas neste
lote. As APIs de entrega legadas permanecem por contrato de cutover. O restante
das 130 assinaturas possui caller de frontend/Edge, dependência RLS ou contrato
canônico/compatível comprovado; deve ser revisto domínio a domínio, com smoke
do consumidor antes de qualquer novo corte.
