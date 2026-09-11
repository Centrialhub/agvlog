# Auditoria de manutenção e despesas antigas frente aos custos canônicos

Escopo somente leitura do plano, tracker, fontes frontend, baseline e migrations candidatas. Nenhum SQL/UI alterado, nenhum banco remoto consultado ou modificado.

## Resultado

Não há vínculo de identidade entre driver_expenses/maintenance_orders e finance_expense_items ou record_manual_expense. Logo, ausência de link hoje **não prova custo novo**. Somar as tabelas cria risco concreto de duplicação por redigitação. É correto manter cobertura explícita incompleta no resumo52557 até adotar fontes com decisão auditada porID.

O plano exige OS→item de custo→documento/obrigação→pagamento e distingue compra de consumo do estoque (`planejamento-financeiro-2026-09-09.md:462`). O tracker documenta a exclusão provisória e a remuneração já incluída, especialmente seções263–277/331–337/438–448.

## Escritores e vínculos atuais

| Fonte | Escritor atual identificado | Vínculos comprovados | O que não prova |
|---|---|---|---|
| maintenance_orders | useMaintenanceOrders.tsx:47–77 faz INSERT/UPDATE direto; MaintenanceOrders.tsx:66–86 calcula total_cost no navegador como parts_cost+labor_cost | vehicle_id, asset_id, responsible_employee_id, incident_id, schedule_id | Não tem payable_id, canonical expense ID, documento/recebimento ou saldo de obrigação. supplier_vendor/cost_center são textos |
| maintenance_parts | useMaintenanceOrders.tsx:94–104 faz INSERT direto | maintenance_order_id, stock_item_id, stock_movement_id, quantity/unit_cost/total_cost | Não há prova automática de que seus valores já estão no parts_cost da OS, nem de compra externa nova |
| stock_movements | useStock.tsx:95–117 insere movimento e depois atualiza current_quantity em outra chamada | maintenance_order_id, stock_item_id, movement_type, quantity/unit_cost/total_cost | Fluxo físico não é pagamento. Compra e consumo podem representar mesma peça em momentos diferentes; atualização de quantidade não é comando financeiro atômico |
| driver_expenses | useExpenseCreation.ts:26 chama create_driver_expense_command; useExpenseReview chama review_driver_expense | creation_command_id, review_command_id, dispatch_trip_id/manual_settlement_id, driver_id, recibo, payment_source/reimbursable/paid_with_advance | Não possui finance_expense_item_id. payment_source é declaração operacional, não extrato nem prova de envio |
| Despesa aprovada da empresa | _tg_sync_obligations_from_expense203548:151–165 | financial_obligations.source_table='driver_expenses', source_id exato; só approved, não reembolsável e payment_source diferente de driver | Essa obrigação não é finance_movements ou payables. Não criar segundo título automaticamente |
| Acerto legado | _build_driver_settlement e driver_settlement_items | source_table='driver_expenses', source_id e snapshot da aprovação/reembolso | Composição é apresentação/cálculo do mesmo gasto, não outro custo ou dinheiro novo |
| Folha legado | gerador e deduplicate_payroll_reimbursements132406 | source_table/source_id de driver_expenses e cobertura de despesas do acerto preservada em source_metadata | Crédito de reembolso não é remuneração nova. Folha aprovada/paga não deve ser refeita para integrar KPI |
| Custos canônicos | expense_batches213959, manualexpense120756 e recorded_costs25357/30032 | finance_expense_items.payable_id único, allocations por expense_id; record_manual_expense identifica título no resultado do command | context='maintenance' ou category='maintenance' não identifica uma OS específica |

Permissões de manutenção/estoque foram endurecidas em25220834 para leitura interna e escrita admin. Isso não substitui can_access financeiro para futuros comandos de adoção, inclusive rejeição de perfil misto motorista. Não ampliar escopo agora para refazer a operação de estoque.

## Deduplicações que já são demonstráveis

1. Item canônico versus obrigação complementar: payable_id exato; recorded_costs não soma o título e exclui manual quando esse mesmo ID aparece no lote.
2. Item canônico versus acerto:34948 adiciona driver_settlement_items.source_table='finance_expense_items' por source_id exato e marca reimbursable=false/settlement_credit_created=false. Os KPIs devem contar finance_expense_items uma vez, sem somar novamente a linha do acerto.
3. Despesa legada versus acerto/folha: source_table+source_id e snapshot de cobertura132406 permitem reconhecer uma origem única de reembolso. O snapshot histórico tem prioridade sobre composição recalculada. Cancelado com pagamento ativo exige revisão, não liberação automática.
4. Peça versus movimento físico: stock_movement_id e stock_item_id podem identificar a mesma ocorrência quando tenant, OS, item, quantidade e custo estão coerentes. A existência de UUID isolado não basta; nenhuma dessas colunas liga a ocorrência a custo canônico ou obrigação de compra.

Não são provas: mesmo valor/data/motorista/fornecedor, número textual de documento, nome de centro, categoria maintenance, valor total da OS igual à soma de peças, ou ausência de pagamento aparente no sistema.

## Proposta mínima implementável

**Primeiro entregar inventário de custos legados**, separado do inventário de dinheiro: drivers approved/pending/rejected, OS porstatus, peças e movimentos relacionados. Paginar fontes, incluir semdata/valores nãofinitos/órfãos, expor source_revision determinística e todos IDs de composição/obrigações/pagamentos encontrados. Não dar total global enquanto sobreposição for desconhecida.

**Depois associação auditada de fonte a custo já existente**, sem criar dinheiro/obrigação. Tabela explícita de associação com tenant, source_table+source_id, target_kind (expense_item ou manual_expense_command/request_id), valor/parcela integral em centavos, snapshots de ambas as pontas, reviewer/tempo/motivo e declaração de identidade do mesmo gasto. Reversão append-only somente da associação. Preview revision obrigatória; serialização finance e reauth após espera; unicidade/capacidade porfonte/alvo para não atribuir o mesmo centavo duas vezes. Não tratar associação de custo como conciliação bancária.

Para primeira implementação, aceitar somente fonte integral cujo valor/atribuição sejam comprovados; bloquear frações/OS compostas e qualquer conflito com título/reembolso/folha já pago até representação explícita. Isso evita inventar rateio. Um comando separado futuro poderá reconhecer custo legado ainda não representado, mas deverá declarar e revisar a inexistência de representação equivalente; não pode ser simples INSERT finance_expense_items com novo payable.

**Integração da composição antes de liberar KPIs como completos:**34948 soma driver_expenses antigos e finance_expense_items novos no acerto. Se associarmos essas duas representações do mesmo fato, o builder também precisa excluir uma delas pelo ID da associação; mudar só recorded_costs deixa custo duplicado no resultado da viagem. Preservar a obrigação de reembolso original (despesa paga pelo motorista) sem transformá-la na regra canônica não reembolsável. Se o item canônico já tem payable/allocations, verificar conflito explícito antes de vincular. Folhas/acertos protegidos mantêm snapshots e recebem pendência de revisão; não reescrever histórico.

**Manutenção por componentes:** reconhecer separadamente serviço/mão de obra externa, compra direta de peça e consumo de estoque. OS total não é uma quarta fonte. Parte de estoque exige política de custo de consumo e vínculo à aquisição/estoque; não cria novo contas a pagar. Até essa política/modelo estar definido, componente permanece pendência. Textos de fornecedor e centro precisam de escolha explícita de IDs; não normalizar automaticamente por nome.

## Riscos e aceitação necessária

- Mesmo gasto em driver_expenses e lote: uma fonte de custo, reembolso já devido preservado, nenhum pagamento novo.
- Mesmo gasto em acerto e folha: IDs de cobertura, already_paid e pagamentos reais preservados; approved/closed e cancelled pago não recalculados silenciosamente.
- Associação disputada por dois usuários: somente um vínculo ativo; replay não duplica; fonte alterada após preview retorna conflito.
- OS com parts_cost agregado e peças detalhadas: só componentes explicitamente adotados, sem somar cabeçalho novamente.
- Consumo de peça comprada antes: não registrar nova obrigação/pagamento; custo de consumo conforme política definida, sem fingir que estoque é extrato.
- Recebido/cancelado/rejeitado operacional não significa reversão financeira. Corrigir ligação exige trilha própria; corrigir valor histórico exige comando distinto.
- Fonte ou alvo de outra empresa, sem data, valor negativo/infinito, quantidade inconsistente ou identificação ambígua bloqueia adoção automática e aparece no inventário.

Esta etapa ainda não implementou inventário/associação de custos; o relatório delimita a próxima entrega. Não recomenda relaxar imutabilidade ou reaproveitar associação de pagamentos43833 como identidade de despesa.
