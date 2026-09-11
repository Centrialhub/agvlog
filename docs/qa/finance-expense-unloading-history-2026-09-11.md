# Histórico de gasto versus direito de cobrança — 11/09/2026

Implementação local: ExpenseUnloadingHistory apresenta custo original/prestador separado do direito vigente/devedor, original e alterações por data econômica/registro/ator/motivo. Nunca usa custo como saldo de recebível. Ausência de DTO, origem não comprovada ou identidade de tenant/charge/receivable incompatível não apresenta valor vigente. expenseHistoryContract usa schema compartilhado da nova origem.

FinanceExpenses distingue comprovante original, anexado posteriormente, ausência justificada e ausência sem justificativa; não apaga ausência original no detalhe.

11 testes UI aprovados (6 origem/identidade/cancelamento e 5 histórico), lint0. Fonte compartilhada ainda em desenvolvimento coordenado; reader SQL e wrappers de origem não publicados. Não afirmar teste E2E nem publicar recurso de correção antes integração completa.

Verificação da Edge secure-upload já implantada: POST sem autenticação401; OPTIONS do domínio preview200 com allow-origin exato. Isso prova fronteira/preflight, não upload autenticado completo.
