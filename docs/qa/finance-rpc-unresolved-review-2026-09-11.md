# RPCs dinâmicas — auditoria final de catálogo2026-09-11

O inventário contém33 ocorrências não resolvidas:4 argumentos dinâmicos e29 nomes dinâmicos. Estes29 dividem-se em19 transports locais rpc(name,args), não exportados, e10 dispatches de conjunto finito, totalizando21 nomes literais distintos. Nenhum desses nomes vem de input livre do usuário; seleção decorre de kind validado no contrato. Resolver AST e inventário por arquivo/linha em review-finance-rpc-dynamic-adapters.mjs e finance-rpc-dynamic-adapter-review-2026-09-11.json. A auditoria manual conferiu forwarding e escopo; o script não é um resolvedor geral interprocedural.

Consulta somente catálogo de25 nomes (21ramos+4 pendências) em produção: todos existem com1overload, argumentos nomeados compatíveis, EXECUTEauthenticated=true eanon=false. Resultado exato finance-rpc-unresolved-live-result-2026-09-11.json; SQL reexecutável finance-rpc-unresolved-catalog-2026-09-11.sql.

Quatro chamadas:
- useDriverSettlements262: adaptador de tipos devolve objeto inalterado. _settlement_id,_audited_km,_km_status,_notes são enviados; _km_start,_km_end,_audited_start_location,_audited_end_location quando undefined são omitidos emJSON e possuem DEFAULT NULL no banco.
- useDriverSettlements356: _tenant_id,_driver_id,_vehicle_id,_reference_date,_load_ids todos enviados; veículo/data usam NULL explícito, não omissão. Assinatura5args semdefaults compatível.
- unbilledFreightClient7: args retorna _tenant_id,_from,_to,_client_id. Datas/cliente nullable coincidem com SQL.
- unbilledFreightClient8: spread anterior+_state,_page; seis chaves exatas. Defaults SQL também compatíveis.

Os21ramos usam exclusivamente _payload jsonb. Esta conclusão resolve assinatura/ACL/forwarding, não substitui smoke browser, validação semântica do payload, RLS, autorização apósespera ou teste de cada comando. Nenhuma RPC financeira foi executada nesta consulta e nenhuma produção foi alterada. ManifestoASToriginal preservado; resultado complementar explícito não o transforma em homologação global.
