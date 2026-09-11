# Mão de obra externa da manutenção: associação a custo existente

Migration local `20260910160950_finance_maintenance_labor_cost_associations.sql`, SHA256 `920a5e306cbef22499dc6b24746a6583e28d62bd0536dc15c640d7e3abc6fa76`. Nenhuma aplicação remota.

## Comportamento

Uma OS concluída pode ter seu componente `labor_cost` associado integralmente a um `finance_expense_items` existente. O lote deve ter contexto `maintenance`, categoria `maintenance` ou `service` e fornecedor cadastrado por `supplier_id` da mesma empresa. Texto `supplier_vendor` da OS não determina identidade; o usuário seleciona o custo, confere fornecedor e declara explicitamente tratar-se da mesma mão de obra.

Não cria custo adicional, obrigação, pagamento ou movimento. Não soma `total_cost`, `parts_cost`, peças ou estoque. O custo já existente continua sendo a única fonte do resumo canônico. O vínculo acrescenta rastreabilidade por OS. Não certifica conciliação bancária nem autenticidade documental.

O dia de abertura da OS não é presumido como competência do custo. Ambas as datas permanecem no snapshot. Valor da mão de obra deve ser positivo, finito, inteiro em centavos e integralmente igual ao alvo. Título do alvo, quando existe, precisa preservar fornecedor e valor, e não estar cancelado. Outro título derivado por IDs da OS/obrigação exige revisão explícita.

## Contrato

- `associate_finance_maintenance_labor(_payload)`: `version:1`, `tenant_id`, `request_id`, `order_id`, `cost_id`, `revision`, `reason` (10..2000), `same_labor_confirmed:true`.
- Resultado: versão/empresa/request/order/cost/link IDs, `amount_cents` string, `cash_created:false`, `obligation_created:false`, `confirmed:true`.
- `reverse_finance_maintenance_labor_association(_payload)`: versão/empresa/request/link IDs, motivo.
- Resultado: mesmos IDs, `reversal_id`, centavos, `cash_changed:false`, `obligation_changed:false`, `confirmed:true`.

Tabelas `finance_maintenance_labor_links` e `finance_maintenance_labor_reversals` são append-only, com RLS e somente leitura para os papéis da aplicação. O vínculo persiste `supplier_id`, autor/nome, motivo, horário e snapshot. Uma origem e um alvo só podem ter uma associação ativa pelos comandos serializados. Após reversão, reassociação recebe novo ID.

Revisão combina OS, item, lote, fornecedor, títulos/pagamentos pertinentes, obrigações, alocações e histórico de vínculos/reversões. O JSON revisado é preservado integralmente. Mudança da revisão exige nova conferência (40001 `finance_maintenance_labor_changed`). Replay exige ator, ação e payload idênticos.

Autorização financeira antes e depois da trava financeira da empresa e novamente após a trava da OS. Escrita operacional da OS tenta a mesma trava sem esperar em ordem inversa. Motoristas, inclusive perfil misto, são rejeitados pela política financeira vigente.

## Correções e operação da OS

Enquanto associado, não se altera identidade, empresa, mão de obra, fornecedor textual, veículo/ativo ou status da OS. Notas operacionais permanecem editáveis. Reversão preserva dinheiro e histórico; depois dela esses dados podem ser corrigidos e passar por nova revisão. Snapshot da associação anterior permanece intacto. Não se congela toda a operação da OS permanentemente.

Eventos `maintenance_labor_associated` e `maintenance_labor_association_reversed` preservam intervenção manual. O integrador acrescentou esses eventos à auditoria manual na migration de leitura 61129; consulta/UI são entregas separadas.

## Validação

`npx vitest run src/test/financeMaintenanceLabor.test.ts`: **7 testes passaram**. ESLint do teste e helper: código 0. Fixture `createMaintenanceLaborDatabase` reutiliza o schema de custos e cria custos/títulos por `record_finance_expense_batch` real.

Provas: replay; preservação de título e ausência de novo movimento; valor apenas da mão de obra (50 contra cabeçalho 120 com peças 70); fornecedor cadastrado independente do texto antigo; declaração e acesso; duplicidade ativa; revisão alterada por título e por OS; outro título derivado da OS; notas editáveis; proteção financeira ativa; reversão e correção sem apagar snapshot; valor inválido/OS não concluída; alvo com obrigação cancelada.

Validação concorrente PostgreSQL real atribuída a `bank_period_evidence`, não incluída na contagem acima. Não foi iniciado segundo servidor nativo nesta frente.

## Pendências de cobertura

Alvo direto `finance_manual_expenses` ainda não é aceito: esta entrega usa somente itens de lote, evitando tratar representações do mesmo título como alvos independentes. Peças compradas diretamente, consumo de estoque e política de custeio continuam etapas separadas. Fornecedor sem ID exige saneamento prévio; não é resolvido automaticamente pelo nome. Não declara incorporação completa da manutenção nem adoção global dos históricos.
