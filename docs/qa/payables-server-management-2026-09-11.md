# Contas a pagar: lista operacional paginada

Payables.tsx reutiliza PayablePortfolioPanel/get_finance_payable_portfolio, com totais integrais e30linhas por página, revisão explícita e reinício após alteração. Não consulta usePayables/select(*) sem limite. Abrir conta/Baixas carrega exclusivamente tenant_id+id com single; resposta fora da identidade pedida é recusada; resposta atrasada de seleção anterior é descartada.

Foram removidos desta rota os filtros locais de busca/status/origem e exportação CSV da resposta truncada. Permanecem os filtros reais da API: vencimento ou criação, intervalo, categoria e fornecedorID. Recuperar busca textual e status globais exige extensão servidor; não filtrar só a página. Totais são saldo/nominal/pago/vencido comprovados, não soma nominal por status. Dashboard conserva botão Gerenciar.

7 testes passaram em2.03s:5payablePortfolioPanel e2payablesServerManagement; ESLint0. A prova de1005 é UI com resposta controlada, não testeSQL novo; o RPC existente tem suas provas SQL/nativas anteriores. Nenhuma alteração deSQL/produção. Hooks de mutação existentes invalidam a carteira via invalidateAccountReview. Comprovantes não alterados.
