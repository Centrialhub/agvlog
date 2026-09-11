# Conferência de componentes de manutenção — UI (2026-09-10)

Painel MaintenanceCostContextPanel acessível por botão nas ordens de manutenção do inventário de custos antigos. FinanceAccessBoundary protege a consulta, incluindo exclusão de motoristas/mistos. Leitura por empresa/ator/OS, sem comando financeiro ou mutação.

Cabeçalho declarado, peças e movimentos físicos são seções distintas. Não há soma entre essas representações nem custo reconhecido presumido. Valores/datas/quantidades inválidos permanecem indeterminados. IDs de OS, peças, itens e movimentos estão disponíveis para rastreio. Inconsistências recebem rótulos de negócio. Listas de peças/estoque paginam separadamente 30 registros na mesma página; totais do cabeçalho não são inferidos da amostra.

Query finance-maintenance-cost-context; schema maintenanceCostContextSchema rejeita completude/valor reconhecido inventados, identificação incompatível e IDs duplicados. Atualização ou falha oculta contexto anterior. Invalidações adicionadas a sucesso das mutações existentes em useMaintenanceOrders/useStock, sem alterar escritores.

Seis testes UI/cliente/inventário passaram; lint do escopo sem erros. Root confirmou quatro testes SQL reais através do schema60441. Sem TSC próprio concorrente. Nenhum SQL ou banco remoto alterado nesta frente.
