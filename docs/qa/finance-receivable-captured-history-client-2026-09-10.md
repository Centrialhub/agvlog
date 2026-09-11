# Consulta integrada do histórico capturado de recebíveis

A consulta pública `get_finance_receivable_history` retorna versões observadas dos títulos, inclusive excluídos, com filtro opcional por ID e páginas de 50 eventos. O contrato não apresenta valores como posição econômica de uma data passada. O começo da captura é explícito; ausência de evidência anterior não vira saldo zero.

O cliente valida empresa, filtro, página, revisão, operação, autoria e identidade do devedor preservado. Valores monetários são strings exatas de centavos; valores ausentes ou inválidos permanecem nulos. Nenhum cálculo em Number converte valores monetários grandes. Os lados antes/depois precisam corresponder à operação e a quantidade de linhas precisa corresponder à contagem integral retornada.

Páginas posteriores exigem revisão do conjunto. Erro40001 ou resposta com revisão diferente produz ReceivableHistoryChangedError. A tela reinicia com uma geração nova de consulta, mesmo se a primeira página estiver em cache com staleTime infinito. Erros de acesso e transporte permanecem distintos. A recuperação não conserva dados antigos como resultado atual.

Criação e alteração de títulos e a invalidação financeira central agora invalidam também finance-receivable-history. A interface usa empresa e ator na chave e controla acesso com FinanceAccessBoundary; o servidor verifica can_access sem conceder leitura direta nas tabelas privadas.

## Evidência

O coordenador executou 25 testes aprovados em quatro arquivos: sete SQL, seis de contrato, cinco de cliente e sete de interface. Os testes SQL usam o parser público real e percorrem1005 eventos em21 páginas. Cobrem exclusões, alteração de valores e vencimentos, rótulos preservados, valores inválidos e isolamento. O ensaio nativo separado verifica a transação que confirma mais tarde com sequência menor.

ESLint dos arquivos de contrato/cliente, hook de recebíveis e invalidação central passou. A interface possui sua evidência própria. A verificação de tipos final, sessão32338, concluiu com saída0 e nenhum diagnóstico.

O suplemento PostgreSQL nativo concluiu três casos aprovados na sessão54067, saída0 e servidor parado. O coordenador conferiu log e hash: paginação pelo RPC com parser real, confirmação tardia com sequência menor invalidando revisão e exclusão de motorista/papel misto/permissão revogada. A evidência e seus limites estão em finance-receivable-captured-history-native-2026-09-10.md.

SQL congelada: 20260910201323_finance_receivable_captured_history.sql, SHA2568a94f49b025db40e3a1629b091c0e33180720579e37c8fa04149cd28bca80fe6.

## Limites

Isto é histórico de versões capturadas, não histórico de confirmações transacionais nem saldo as_of. Não substitui a paginação do histórico específico de pagamentos, a reconstituição econômica das carteiras, a homologação da cadeia completa de migrations ou a implantação remota. A consulta calcula a revisão de todo o conjunto filtrado; o teste de1005 eventos comprova integralidade nesse volume, não uma certificação de desempenho para volumes arbitrários.
