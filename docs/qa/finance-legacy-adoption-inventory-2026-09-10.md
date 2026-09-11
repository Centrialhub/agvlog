# Consulta de pendências históricas — SQL executável

Migration criada pelo CLI Supabase: `20260910142740_finance_legacy_adoption_inventory.sql`. Somente leitura; nenhuma adoção, lançamento financeiro, conciliação ou aplicação remota.

SHA-256: `872ca49f8f8e033d43d279bed1452064f106782a5efdd642c3cb39cd1504c35c`.

`npx vitest run src/test/financeLegacyAdoptionInventory.test.ts`: **14 testes passaram**. ESLint do teste passou. Todas as respostas SQL dos testes são analisadas pelo `legacyInventorySchema` real do cliente; apenas a conexão Supabase é substituída, não a consulta.

## Contrato

`get_finance_legacy_adoption_inventory(_tenant_id uuid, _account_id uuid, _from date, _to date, _page integer default 1)`.

Página de 30, ordenação estável por data/origem/ID. `total`, `counts_by_source` e `rows` no primeiro nível são da conta selecionada. `unknown_account` tem seu próprio total, contagens e página, escopo `tenant` e `not_additive_across_accounts=true`. As duas seções usam o mesmo número de página, com paginação independente das linhas. Não há soma monetária.

Sempre `legacy_integration_status='not_reviewed'` e `can_close=false`, inclusive vazio. Valor incerto/inválido retorna `amount_cents:null`, sem arredondamento de centavos. Operadores autorizados podem ler; motoristas e perfis mistos são rejeitados, assim como conta estrangeira e filtros inválidos.

## Base e plano executado

Fixture com definições reais de tabelas, tipos, defaults e chaves primárias do baseline para dinheiro, cargas, fechamento, adiantamentos e itens da folha. As colunas posteriores dos pagamentos de carga/fechamento são acrescentadas. Tabelas de vínculos/reversões são extraídas das migrations reais; FKs para grafos/comandos não necessários ao leitor são omitidas deliberadamente para também permitir cenários legados incompletos. Não representa aplicação integral de todas as migrations nem prova as guardas de escrita.

O teste de `EXPLAIN (ANALYZE, FORMAT JSON)` lê `pg_proc.prosrc` da função real e explica/executa o corpo com parâmetros tipados. Confirma nós `Append` e contagens reais, além da execução normal da RPC. Assim, não se limita ao `Function Scan` externo. O plano foi validado em fixture pequena; não constitui benchmark de alto volume ou decisão de índices para produção. Materialização de candidatos permite total e páginas da mesma consulta/snapshot.

## Cobertura por fonte e limitações

| Fonte | Comportamento validado / limite |
|---|---|
| Recebíveis | Pagamento e devolução são histórias separadas; somente IDs de vínculo exatos removem cada pendência. IDs existentes não substituem diagnóstico integral de integridade de conta/valor/data. |
| Pagáveis | Pagamento com vínculo canônico histórico não reaparece quando alocação é revertida. Sem vínculo, continua candidato; nenhum comando de pagamento é reexecutado. |
| Acertos | Pagamento sem vínculo ativo aparece na seção sem conta; reversão reabre associação pendente, sem recriar dinheiro. `payment_account` textual não é interpretado como ID. |
| Carga e fechamento | Projeções com pagamento canônico existente são excluídas. Mesmo valor/data/recebível sem ID de pagamento não é deduplicado. |
| Adiantamentos | Status pago com soma de pagamentos ativos ausente/parcial/excessiva fica pendente com valor de dinheiro nulo. A data usa paid_at, ou advance_date como localização operacional do registro; isso não prova o dia do dinheiro. Divergência entre múltiplos títulos ligados e estado do adiantamento ainda exige revisão. |
| Folha | `already_paid` com ID de pagamento de acerto/adiantamento/pagável existente não duplica sua origem. Sem fonte resolvida, aparece com valor nulo e direção desconhecida. A existência da origem não comprova seu pagamento: a origem possui seu próprio diagnóstico. Somatórios antigos de payroll_entries sem itens rastreáveis não são reconstituídos. |
| Banco antigo | Linha referenciada pelos pagamentos não aparece uma segunda vez. Linha sem referência precisa classificação; importação antiga, raw_payload ou status matched não comprovam evidência canônica. |
| Transferências/custos/obrigações | Não entram como dinheiro adicional; movimentos canônicos, pares, composição de despesas e títulos têm outras verificações. Não há pareamento antigo por valor/data/nome. |

Fontes com data ausente não pertencem ao filtro de período e necessitam diagnóstico específico. IDs órfãos, metadados divergentes, registros apagados por estornos antigos, cobertura de extratos e carteira de abertura continuam exigindo tratamento separado. Nenhuma lista vazia libera fechamento. A consulta de exemplo do inventário anterior permanece proposta histórica; a implementação executada e validada é esta migration, com os refinamentos de folha/adiantamentos descritos aqui.
