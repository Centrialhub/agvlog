# Carteira de contas a pagar — UI — 10/09/2026

Painel `PayablePortfolioPanel` integrado ao Financeiro, com acesso a `/payables` (rota existente). Consulta `readPayablePortfolio`, com totais completos do servidor e até30 títulos por página. Filtros próprios por vencimento ou criação, claramente separados dos filtros superiores do dashboard.

A posição é operacional atual, não reconstrução histórica nem saldo bancário. Pagamentos alocados são distintos de caixa. Cancelados continuam visíveis, com valores declarados originais nos detalhes e exclusão explícita dos valores ativos. Títulos sem data para o filtro permanecem como pendência sem atribuição ao período. Valores indeterminados não são substituídos por zero; falha ou atualização oculta dados anteriores.

Paginação fixa a revisão recebida. `finance_payable_portfolio_changed` reinicia na página1, sem revisão anterior, invalida a primeira consulta e informa a mudança. Não mistura páginas de revisões diferentes. Chave: finance-payable-portfolio, empresa, ator, filtros, página, revisão. Workspace reinicia na troca empresa/ator; FinanceAccessBoundary restringe acesso, inclusive motoristas em perfis mistos conforme regra compartilhada.

Rótulos legíveis cobrem os15 códigos fornecidos pelo autor do banco. Detalhes por título exibem IDs de origem, favorecido e pagamentos; não fazem baixa nem modificam títulos.

Validação: quatro testes UI passaram (totais integrais/cancelados/semdata/navegação, revisão alterada, falha/indeterminado e filtros). ESLint aprovado para componente, labels, teste e Financial. Contrato/cliente/SQL/testes de backend são propriedade do coordenador e autor do banco, sem alterações nesta entrega. TSC integrado será registrado pelo coordenador se houver execução concorrente.

Arquivos: src/components/financial/PayablePortfolioPanel.tsx, src/lib/financial/payablePortfolioLabels.ts, src/test/payablePortfolioPanel.test.tsx e src/pages/Financial.tsx.

TSC integrado9183 concluído com exit0; log finance-payable-portfolio-ui-tsc.log vazio. Nenhum processo TSC ativo nesta entrega.
