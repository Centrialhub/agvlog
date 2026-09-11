# Auditoria das intervenções recentes

Produção confirmou gap: consulta audit_events contém correção de custo anterior, mas não complemento/regularização/devolução/aprovação revisada/previsão. Migração94523 verifica corpo MD5afb87498db64fe6bb94ac3694be66087 e segurança/ACL, acrescenta seis ações às duas expressões (classificação e filtro manual), preservando integralmente filtros e eventos.

Não reescreve eventos, não converte conciliação automática em manual, não cria valores. Rótulos de UI adicionados também para correção de origem/cancelamento/custo existentes. Três testes SQL reais com definição de produção preservada + dois testes da tela passaram; lint limpo. Cobertura: responsável/motivo intactos, filtro e contagem/páginas30+1, ação+ator, tenant/driver, drift rejeitado. Fixture local com leitor real, não sessão Auth hospedada.

SQL SHA256 db1ec8ab64ac31b82d146f0715c6a0ce99b8f9a30e4194b16a7b1be6ffeabb40

Arquivos delimitados: migração94523, financeAuditContract.ts, financeCurrentManualAudit.test.ts, predecessor SQL de auditoria, esta QA. Aplicação remota ainda pendente no momento do commit.
