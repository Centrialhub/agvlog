# Integração da carteira completa a pagar

Cliente `readPayablePortfolio` e contrato `payablePortfolioSchema` validam empresa, filtros, página e revisão solicitados. A resposta conserva o conjunto completo de totais; não soma a página no navegador. Há verificações de quantidade de linhas, duplicidade de títulos, contagens, valores indeterminados, saldo nominal=pago+aberto e total da página que não pode exceder a carteira. Fontes sem data de corte continuam identificadas explicitamente.

Quatro testes próprios passaram, incluindo resposta de outra revisão/filtro, página incompleta, total incompatível e um título problemático fora da página visível que mantém todos os totais globais indeterminados. O backend também valida suas respostas reais pelo mesmo parser.

Verificação integrada: 28 testes passaram em client, painel, carteira SQL, integração do cancelamento de despesa e regressão da associação de pagamento legado. A fixture antiga de lote foi atualizada para ler o contrato histórico atual, instalando o DDL real da tabela de cancelamentos e o reader75733; seus 11 testes e os três de cancelamento passaram. Essa fixture não afirma validar comandos de cancelamento, exercitados separadamente pela factory completa.

Atualização de cache inclui a carteira após criação/alteração de título, baixa, reversão/associação de pagamento legado e cancelamento de despesa. Os eventos também atualizam revisões financeiras afetadas. ESLint passou nos arquivos alterados.

Root conferiu o log nativo3320 e o hash180040 `51773219434d93c0a7cade674b75381f5a5e2f4dcc6dbd9bd24fd04f52c482f5`: três casos passaram, servidor parado. A análise de plano com1.005 títulos mediu182,150ms na fixture local, sem promessa para produção. A carteira é uma posição operacional atual; os filtros não a tornam uma posição histórica. Navegador com sessão real, cadeia integral de migrações e aplicação remota continuam pendentes.
