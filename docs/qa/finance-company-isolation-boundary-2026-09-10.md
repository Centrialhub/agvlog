# Isolamento financeiro por EMPRESA — auditoria e correção local

Data: 2026-09-10. Nenhum DDL remoto, Sites, TSC ou PostgreSQL nativo executado nesta rodada.

## Resultado

A associação ao workspace não é a seleção da EMPRESA. A sincronização `20260911020515` replica vínculos internos para empresas do workspace; portanto `is_tenant_operator_or_admin(tenant)` sozinho não é uma fronteira de empresa selecionada. O header do cliente também não basta: deve corresponder ao claim `active_tenant_id` validado no servidor.

`20260910224136_finance_active_workspace_access.sql` combina o vínculo interno/não motorista com claim não vazio e `private.is_request_tenant_member`. Quatro testes PGlite passaram. Ela preserva deliberadamente `can_access=false`: a ativação deve instalar a variante com empresa ativa, nunca restaurar o corpo original da foundation. Nenhum gate foi ativado neste trabalho.

## Correções locais prontas

- `20260911025149_finance_receivable_invoice_active_read_boundary.sql`: protege `get_receivable_financial_context`, `get_client_invoice_action_context`, `list_client_invoice_financials`, `get_client_invoice_creation_context` com `finance_private.require_access`.
- `20260911025214_finance_client_invoice_active_command_boundary.sql`: protege `apply_client_invoice_command` antes do trabalho e após a espera advisory, antes do replay. Mantém a trava de membership e os locks NOWAIT do grafo existentes.

Ambas foram criadas via CLI. Validam hashes exatos de prosrc normalizado, linguagem, volatility, SECURITY DEFINER, search_path, argumentos e ACLs (owner/authenticated; sem PUBLIC, anon ou service_role). Preservam definição original, OID, defaults e grants. Não mudam fontes fiscais, snapshots, valores nem histórico. A segunda patch opera faturamento financeiro; não emite documento fiscal.

SHA256:
- 25149: `32449002ad91c32a212f6dff57690a11e02e52e32b6b6e67fec14560e902e9c3`
- 25214: `33ca92e34615eb1c31e1b38e8428a5d0c4e7b775795afb128830ed5fbc738768`

## Evidência local

`financeInvoiceCompanyBoundary.test.ts`: 3 testes passaram em 23:55:09 (6,36 s); ESLint passou.

- Antes da patch, ator membro das duas empresas com claim B conseguiu as quatro consultas de A: regressão reproduzida com fatura/recebível reais do fixture.
- Após patch, todas negam A sob claim B; claim A permite. Header divergente e claim ausente são negados.
- Comando financeiro real mark_sent e replay mantidos; replay sob outra empresa ou identidade motorista/interna negado; um único evento de comando.
- ACL divergente em uma das quatro funções rejeita instalação; rollback permite instalação íntegra. Gate false mantém consultas negadas.

Fixture usa a cadeia real de fechamento/recebíveis/faturas e definições reais dos helpers de autenticação/empresa. O adaptador auth.jwt em PGlite representa claims fornecidos pelo teste; não prova validação criptográfica de JWT, browser/Auth hospedado, todo esquema MAINDB, nem concorrência nativa de revogação durante espera. A migração tem reauth estrutural após espera, sem alegar prova nativa nesta rodada.

## Ainda necessário antes de ativação abrangente

1. Fronteira dos fechamentos operacionais financeiros: hooks atuais chamam `get_closing_report_sources`, `get_closing_report_action_context`, `create_closing_report_draft`, `apply_closing_report_action`, `update_closing_report_trip_fields`. Definições 161722/165149/174819 usam role legado; não constam em 235237. Revisar efetivas e aplicar gate de empresa/motorista; os dois comandos têm advisory wait e exigem reauth antes replay.
2. Verificar `filter_billable_fiscal_sources` e demais RPCs descobertas no mapa route/hooks. Não alterar workers de sistema para exigir JWT interativo indiscriminadamente: eles precisam tenant explícito e cadeia íntegra, com fila/cron ainda pausados até readiness.
3. Aplicar/conferir o sweep restrictive `agvlog_active_tenant_context` após as novas tabelas financeiras. Ele protege acesso direto, mas não substitui guard em SECURITY DEFINER owner.
4. Conferir catálogo efetivo remoto contra os hashes e patches finais antes de ativar. Este relatório não certifica que toda cadeia posterior já foi instalada em MAINDB.
5. Troca de empresa no cliente: `activeTenantFetch` injeta `x-agvlog-tenant-id`, servidor rejeita discrepância com claim. Readiness da UI deve aguardar a atualização do token e invalidar caches por tenant. Nenhuma alteração de UI nesta rodada.

134948 não foi alterada. Não reaplicar foundation212104 original já incorporada ao rollout staged.

## Complemento 2026-09-11 — fechamentos

Criada via CLI `20260911025737_finance_closing_active_company_boundary.sql`, SHA256 `193f630161cb120961bc990b2067f19a6b7a168250c652a16ee798f08bbe1b52`. Corrige localmente os cinco endpoints de fechamento acima; portanto o item 1 da lista anterior está implementado e testado, ainda depende de revisão/aplicação pelo único coordenador remoto.

Os dois comandos recebem `require_access` novamente após a espera advisory e antes do replay; o editor mantém travas NOWAIT de membership/relatório/item. Hashes exatos, ACL e search_path verificados antes de envolver as funções existentes. Nenhuma definição134948 modificada.

Rodada final `financeInvoiceCompanyBoundary.test.ts`: **5 testes passaram**, início23:59:27, duração12,35s; ESLint passou. Além dos três anteriores, a prova realiza draft/replay, edição de anotação de rota, fechamento/replay reais. Todos os cinco caminhos negam empresa não selecionada e identidade mista; mudança de corpo rejeita instalação e gate stagedfalse nega comando.

`mark_closing_report_sent` antigo já teve os grants revogados em174819, sem necessidade de reabri-lo. `filter_billable_fiscal_sources` (3124505), acionada por useClientInvoices, ainda usa apenas role legado em SECURITY DEFINER; IDs conhecidos de outra empresa podem obter resultado de elegibilidade. Essa consulta auxiliar continua pendência para coordenação, sem alterar geração fiscal.

## Complemento final — seletor de fontes faturáveis

`20260911030051_finance_billable_sources_active_company_boundary.sql` protege `filter_billable_fiscal_sources` com `finance_private.require_access`. Busca de callsites em src, migrations e Edge Functions encontrou apenas as duas consultas de useClientInvoices, além dos testes e tipos. O wrapper já negava service_role; essa ACL permanece. `fiscal_source_is_billable` e os comandos/serviços fiscais não são modificados, logo não foi introduzida exigência de JWT em worker backend.

A rodada final tem **6 testes PGlite aprovados** em00:02:02 (13,54s) e ESLint aprovado. O caso novo instala o DDL real do ledger fiscal e as duas funções reais, semear evidência de documento previamente autorizado apenas no banco em memória: não invoca prepare/claim/dispatch/complete fiscal. Reproduz o retorno de ID sob empresa errada antes da patch, nega depois, preserva ID faturável na empresa correta, nega motorista misto e mantém serviço sem grant. Nenhuma nova emissão fiscal foi solicitada.

Os itens de correção de readers/commands descritos neste relatório agora estão implementados localmente nos quatro arquivos CLI; permanece responsabilidade do rollout verificar catálogo efetivo e aplicar os arquivos sem ativar antecipadamente a cadeia inteira.
