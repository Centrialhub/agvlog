# Associação auditada da aquisição de estoque

Implementação local em 20260910170454_finance_stock_acquisition_associations.sql. SHA256 `8e56e0d16b593974ab2299713253c1282423793c21442c0f671c3bc6bdce9c7e`. Sem aplicação remota.

Entrada inbound/purchase integral pode ser associada por decisão manual a finance_expense_items existente. Quantidade, documento e identidade da compra são confirmados explicitamente. Fornecedor vem do ID do custo, não do texto do catálogo. Snapshot/revisão incluem origem, catálogo, partes relacionadas, custo/lote/fornecedor, títulos/pagamentos/alocações, obrigações da origem, reservas e histórico/dependências.

Reserva finance_maintenance_cost_claims abrange labor, direct_part e stock_acquisition. Um custo integral não pode ser usado simultaneamente nessas famílias. Helpers existentes de manutenção já consultam essa reserva e a incluem em suas revisões. A reversão exige a revisão atual e preserva custo, payable, pagamentos e movimento físico; libera apenas a associação.

Registro privado finance_stock_acquisition_dependencies prepara consumo posterior, com capacidade por quantidade e centavos. INSERT concorrente compartilha trava financeira; aquisição revertida rejeita dependência; reversão da aquisição com dependentes falha. Ainda não existe comando público de consumo ou liberação auditada de dependências. Essa é a próxima implementação, com múltiplas aquisições por consumo por linhas explícitas. O registro não deve ser escrito pelo cliente.

Guards verificam OLD e NEW tenant para travas ordenadas; origem ativa impede alteração financeira ou remoção. Catálogo protege identidade/unidade, permitindo saldo físico e metadados operacionais. Parte não pode apontar a entrada de aquisição ativa como se fosse consumo. Após reversão, correção da origem é permitida, mantendo snapshot anterior.

## Verificação

8 testes de integração PGlite em financeStockAcquisition.test.ts passaram: comando real de custo com payable; associação/replay e preservação de dinheiro/título; declaração e motorista; fonte alterada após prévia; tentativa de trocar tenant da origem e unidade; reserva DB compartilhada/reversão; dependência e sobrecapacidade; NaN/tipo incorreto; comandos reais de mão de obra disputando alvo nas duas ordens. Os temas são agrupados em oito testes.

Regressões labor (7) e direct_part (9) passaram antes do último teste adicional de compartilhamento. ESLint nos dois arquivos próprios passou. Native concorrente ainda não executado por esta entrega; não confundir PGlite com PG nativo.

## Contrato e limites

Comandos e resultados seguem FINANCE-STOCK-MAINTENANCE-CONTRACT-2026-09-10.md; reverse exige revision atual do par. Helpers stock_acquisition_snapshot/revision/issue(tenant,inbound,cost) e stock_acquisition_dependencies(tenant,link) são privados para reader dedicado. Evento manual stock_acquisition_associated ou stock_acquisition_association_reversed inclui ator, tempo, motivo e snapshot.

Alvos desta versão: categoria maintenance/service/office/cleaning/fuel/other, contexto maintenance/office/other, fornecedor ID e documento válidos. Data de compra e entrada são exibidas separadamente; não há inferência de identidade por coincidência de datas. Sem nova receita, custo, obrigação ou transação. O saldo operacional do estoque não foi corrigido por esta mudança. Consumo e valorização ainda não estão implementados; o total canônico continua contando a compra uma vez.

Teste adicional de compra office/PPE preserva a categoria original e um único item canônico. Lock explícito do fornecedor e payable alvo/origem precede revisão, impedindo consentimento obsoleto durante alteração concorrente desses registros.
