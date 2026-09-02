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

## Reauditoria incremental local — 2026-09-02

Foram comparados novamente o frontend atual, o SHA publicado `9efaf137`, Edge
Functions, E2E, corpos SQL e ACLs finais das migrations locais. Dois wrappers
do corte de entregas deixaram de ter justificativa para execução pelo browser:

| Assinatura | Evidência | ACL depois do lote |
| --- | --- | --- |
| `driver_finalize_delivery(uuid,text,text,text[],text,text,text)` | nenhum caller runtime atual ou publicado; E2E atual usa `driver_record_delivery_outcome`; o alias SQL `finalize_driver_delivery` ainda delega para ela | apenas `service_role` |
| `driver_update_stop_status(uuid,text,text)` | nenhum caller runtime atual ou publicado; chegada, saída, resultado e notas têm RPCs separadas e testadas | apenas `service_role` |

A migration `20260902010806_retire_legacy_driver_delivery_browser_acl.sql`
valida hash, `SECURITY DEFINER`, `search_path`, ACL inicial, substitutos,
dependências de policy/view/trigger e callers em corpos SQL antes de revogar.
O único caller SQL aceito é o alias de serviço, também travado por hash,
configuração e ACL. Depois valida que `anon` e `authenticated` ficaram sem
`EXECUTE` e que `service_role` foi preservado.

O E2E do SHA publicado ainda continha uma chamada ao wrapper de finalização,
mas arquivos E2E não integram o bundle publicado. O E2E atual já usa a command
RPC canônica. Testes de banco preservam o wrapper somente como compatibilidade
de backend e comprovam que o navegador recebe `42501` após o novo corte.

As migrations locais posteriores ao inventário também foram classificadas:

- `prepare_mdfe_issue`, `driver_list_load_fiscal_catalog` e
  `driver_get_load_fiscal_file` são APIs `SECURITY DEFINER` com consumidores
  atuais e permanecem executáveis por `authenticated`;
- os leitores cursorizados de ocorrências, cargas, referências do operador e
  histórico do motorista são `SECURITY INVOKER`, portanto não ampliam o alerta;
- nenhuma outra revogação foi selecionada apenas por ausência de string.

O efeito comprovado deste lote é **menos duas assinaturas executáveis pelo
browser**. A contagem absoluta do catálogo deve ser refeita após aplicar todas
as migrations pendentes; o Supabase remoto e um PostgreSQL local completo não
estavam disponíveis nesta reauditoria.

### Verificação remota e portabilidade do preflight

Com o projeto remoto novamente disponível, a reconsulta confirmou 130 funções
`SECURITY DEFINER` executáveis por `authenticated` e mostrou que os três corpos
do lote eram semanticamente idênticos aos fixtures. A diferença de hash vinha
somente dos finais de linha: PostgreSQL remoto armazenou `LF`; PGlite no Windows
preservou `CRLF` dentro de `prosrc`.

O preflight agora normaliza apenas pares `CRLF` para `LF` antes do MD5. Isso
aceita os dois transportes de final de linha, mas preserva um `CR` isolado e
continua sensível a qualquer mudança de tokens, demais espaços, literais,
chamadas ou controle de fluxo. Os hashes canônicos remotos/locais são:

| Assinatura | Hash canônico de `prosrc` |
| --- | --- |
| `driver_finalize_delivery(uuid,text,text,text[],text,text,text)` | `b94b098acff621dddcfbfd0232565c07` |
| `driver_update_stop_status(uuid,text,text)` | `ed77f6d5eea53eeb282edfc9a4736c50` |
| `finalize_driver_delivery(uuid,text,text,text[],uuid)` | `0fc748c47fa464c9781d77518f2c1434` |

ACL, `SECURITY DEFINER`, `search_path`, dependências, callers SQL e APIs
substitutas permanecem gates independentes; a normalização não amplia nenhum
deles.

## Lote incremental: limpeza de reimportação sem intervalo

Reconsulta somente leitura em 2026-09-02 encontrou **129** assinaturas em
`public` que são `SECURITY DEFINER` e executáveis por `authenticated`. A
contagem mudou durante o trabalho paralelo e deve ser lida como snapshot:
nenhuma era executável por `anon`, nenhuma retornava `trigger`, nenhuma tinha
nome interno iniciado por `_` e nenhuma estava sem `search_path` fixo. Só 15
tinham comentário de contrato e 116 preservavam `service_role`.

O inventário em `supabase/verify/security_boundary_inventory.sql` agora retorna
por assinatura: owner, linguagem, hash normalizado, `search_path`/demais
configurações, ACL efetiva, comentário, dependência de trigger/policy, callers
em corpos SQL e referências textuais de views. As referências no repositório
foram cruzadas separadamente com `rg` no frontend, Edge Functions, scripts,
E2E e migrations, além de `git show` no SHA publicado `9efaf137`.

Somente uma assinatura passou todos os critérios deste lote:

| Assinatura | Evidência remota | Referências no repo | Decisão |
| --- | --- | --- | --- |
| `clear_reimport_batch_data(uuid)` | owner `postgres`; `plpgsql`; `search_path=public`; hash LF de `prosrc` `8d0b04f70eb6f935e4faff7f871242b8`; ACL explícita para `authenticated` e `service_role`, sem `PUBLIC`/`anon`; zero caller em function/policy/view/trigger | nenhuma chamada runtime com um argumento; a UI atual e o SHA publicado enviam `_tenant_id`, `_start_date` e `_end_date` após `preview_reimport_cleanup_counts` | revogar de `PUBLIC`, `anon` e `authenticated`; preservar `service_role` |

O substituto limitado `clear_reimport_batch_data(uuid,date,date)` e sua prévia
`preview_reimport_cleanup_counts(uuid,date,date)` também foram travados por
hash (`1e0fc420e4d27711f296c4031e33307e` e
`46c3bf0e7b28d3bcf75c4711ae24b187`), owner, linguagem, configuração e ACL.
A migration `20260902021339_retire_unbounded_reimport_cleanup_browser_acl.sql`
falha antes da revogação diante de drift em qualquer gate ou de novo caller
SQL. Ela não foi aplicada remotamente.

As funções de detalhe/acesso do portal, os dois geradores de número de NFS-e,
o helper fiscal de faturamento e o overload legado de chegada não entraram
neste lote: todos ainda têm caller frontend/fallback, dependência indireta ou
cutover próprio. As 14 funções do lote amplo ainda pendente também não foram
duplicadas aqui; seu rollout permanece coordenado com as command RPCs.
