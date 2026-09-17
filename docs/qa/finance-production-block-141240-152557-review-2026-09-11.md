# Revisão local — próximas 12 financeiras após 140010

Data: 2026-09-11. Checkout observado: eb524526d12af22a55727d64c5736e8b40a28e53. Escopo: análise estática dos arquivos atuais, suas DDL, ACL, triggers e patches; sem aplicação remota, testes, TSC ou Sites. Estado remoto informado pelo coordenador: até 140010, incluindo 134948, aplicado; can_access permanece false. Não verificado remotamente por esta revisão.

Hashes completos e tamanhos calculados dos bytes atuais: `finance-production-block-141240-152557-hashes-2026-09-11.json`. Não reutilizar hashes anteriores do manifesto.

## Ordem concreta e dependências

Todos os prefixos abaixo são 20260910. Manter a ordem e instalar cada migration atomicamente, sem separar o corpo dos blocos DO.

| Ordem | Prefixo / arquivo | Dependências e efeito |
|---|---|---|
| 1 | 141240 finance_cash_opening_counts | 140010 abertura e reader account_opening; auditoria 233625 com patches anteriores. Acrescenta evidence_type com default bank_statement_v1 à tabela existente, valida contagem física em trigger e cria registro auditado cash. Patches do reader exigem três trechos exatos, e auditoria exige needle de ações de identidade. |
| 2 | 142143 finance_statement_coverage_approvals | Evidência/verificação/período bancário anteriores e preserve_event/audit_events. Cria duas tabelas imutáveis de aprovação/reversão, snapshot e comandos com revisão/declarações explícitas. Não atesta banco nem fecha período; can_close=false. Patch de auditoria guardado. |
| 3 | 142740 finance_legacy_adoption_inventory | Tabelas operacionais legadas, links canônicos, folha/acertos e projeções já presentes na cadeia. Inventário somente consulta, escopo por conta/período e fontes sem identificação separadas. Define helper que 143833/145616 modificarão. |
| 4 | 142923 finance_statement_verification_reauthorization | record_statement_verification de 20260909223737, com advisory lock e action verify_statement_source ainda reconhecíveis. Revalida ator após adquirir lock, inclusive replay. Não é leitor nem alteração inerte: modifica escritor service-role existente. |
| 5 | 143833 finance_legacy_payable_associations | Links/reversões de pagáveis, check_movement_use/movement_used_cents, active_payable_payments, histórico/reversão canônica e inventário 142740. Acrescenta origin/default canonical e metadados, remove unique(payment_id), substitui proteção por trigger de capacidade/identidade e mantém histórico. Associa pagamento inteiro existente; reversão não reabre título nem movimenta dinheiro. |
| 6 | 143920 finance_legacy_payable_association_options | Helpers e campos de 143833. Candidatos/histórico página20, revisão da fonte e vínculo ativo independente da página. Somente leitura. |
| 7 | 145616 finance_legacy_receipt_associations | Projeção 024438, correção 025658, links/finance_commands, inventário já modificado por 143833. Duas tabelas novas, capacidade compartilhada e preservação de fontes. Modifica projeção e picker por trechos delimitados e correction/inventory/audit por needles obrigatórios. Associação não cria dinheiro nem pagamento; reversão solta vínculo. |
| 8 | 145659 finance_legacy_receivable_association_options | Helpers de 145616. Consulta/histórico página20, revisão da fonte e vínculo ativo independente. |
| 9 | 150338 finance_legacy_receipt_movement_trace | Função/ACL original 032730, links legados 145616 e créditos/correções canônicos anteriores. CREATE OR REPLACE expande trace canônico/legado; não altera caixa. Preservar ACL existente; não instalar isoladamente se função original faltar. |
| 10 | 151011 finance_legacy_integrity_inventory | Famílias operacionais/financeiras e links das etapas anteriores. Helpers internos revogados, reader autenticado com gate. Inventário empresa, datas/valores inválidos explícitos, duas listas paginadas30; nenhum saldo inferido. |
| 11 | 151617 finance_receivable_portfolio_summary | Receivables/clientes e projeções financeiras já existentes. Agregado completo, pendências invalidam valores; cancelados separados. Não representa posição histórica nem caixa. |
| 12 | 152557 finance_recorded_cost_summary | Custos canônicos de lote, comandos manual_expense 120756, campos de folha e competência já exigidos por 130032. Soma famílias declaradas sem movimentos bancários/reembolsos; manutenção e despesas legadas fora da cobertura. Somente consulta. |

## Instalação com gate fechado

Não há criação/ativação/remoção de cron, chamada HTTP, alteração de buckets ou substituição de can_access nestes 12 arquivos. Não há execução de backfill monetário nem invocação de comandos de abertura, aprovação ou associação durante a migration. As inserções financeiras presentes pertencem aos corpos dos comandos, não a um agendamento ou chamada top-level.

Há defaults de classificação sobre registros existentes: evidence_type=bank_statement_v1 em aberturas e origin=canonical em links de pagáveis. Índices/constraints e DDL podem adquirir locks e validar dados existentes. Isso deve ser distinguido de backfill que cria dinheiro.

Gate=false bloqueia os novos leitores/comandos autenticados e as políticas SELECT. Não torna os seguintes efeitos inativos:

- 143833 instala BEFORE UPDATE/DELETE em bank_transactions. O try_advisory_xact_lock por tenant ocorre antes de verificar vínculo adotado, portanto concorrência pode gerar finance_bank_source_concurrent_change/40001 mesmo em linha ainda não adotada. Fonte adotada permanece imutável inclusive depois da reversão do vínculo.
- 145616 instala BEFORE UPDATE/DELETE em receivables_payments e bank_transactions, também com tentativa de lock incondicional. Pode gerar finance_receipt_source_concurrent_change/40001. Protege histórico adotado permanentemente. Instala ainda triggers de capacidade nas inserções de links canônicos e legados.
- 143833 substitui check_movement_use e active_payable_payments. A mudança é necessária para distinguir reversão canônica de mera reversão de associação; não remover o trigger substituindo o unique antigo por nada.
- 142923 modifica o worker service-role já existente: exige membership ativa owner/admin/operator e nega driver/misto após lock. Não consulta gate nem claim de workspace nesse trecho, pois revalida o ator de origem de execução de serviço; portanto não usar essa migration como prova de isolamento pelo workspace ou pausa do worker.

## ACL, RLS e guards

As quatro tabelas novas de 142143/145616 habilitam RLS, revogam todos os privilégios de PUBLIC/anon/authenticated/service_role e concedem somente SELECT a authenticated com can_access(tenant_id). Escrita passa por funções privadas SECURITY DEFINER com search_path vazio; wrappers públicos são invoker. Eventos recebem trigger de imutabilidade. Não há grant direto de DML nessas tabelas.

Funções auxiliares internas têm EXECUTE revogado inclusive de authenticated/service_role; funções privadas chamadas pelos wrappers concedem authenticated e validam gate/contexto. ALTER/CREATE OR REPLACE em objetos existentes preservam ACL preexistente: conferir especialmente check_movement_use, active_payable_payments, movement_receipt_trace e objetos alterados por pg_get_functiondef. Se predecessor faltar, não criar substituto permissivo para contornar erro.

Os patches exigem os corpos anteriores: 141240 reader/audit; 142143 audit; 142923 verifier; 143833 reverse_payable_link, payable_payment_history, legacy_adoption_candidates e audit; 145616 project_receivable_command, receipt_movement_options, correct_receipt_allocation, legacy_adoption_candidates e audit. Falha de needle/contrato deve abortar atomicamente a migration. Não aplicar só a DDL inicial e ignorar a falha final.

## Parecer e condições verificáveis

Ordem local coerente para continuar instalação staged, condicionada à cadeia anterior íntegra e ao aceite operacional dos triggers imediatamente ativos. Não há scheduler novo que exija arquivo staged de pausa neste lote. Não há evidência nesta revisão de habilitação automática do financeiro.

Antes da aplicação, o coordenador deve conferir hashes dos arquivos consumidos, presença/ACL dos predecessores e ausência das novas tabelas/colunas/triggers para evitar reexecução. Após cada aplicação: comprovar gate ainda false, quatro novas tabelas com RLS/sem DML direto, wrappers sem anon/service_role e corpos/patches esperados. Cron dos workers existentes deve permanecer no estado staged já controlado pelo coordenador.

Esta revisão não executou SQL nem ensaio: não substitui evidência de banco real, nem libera o gate. Este bloco entrega aberturas/avaliação de cobertura/inventários; ainda não é implementação completa de fechamento bancário ou caixa.
