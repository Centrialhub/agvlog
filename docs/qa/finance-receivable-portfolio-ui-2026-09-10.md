# Carteira integral de títulos no painel financeiro

Financial deixou de usar useReceivables e de somar sua amostra para os indicadores de carteira. O resumo servidor alimenta saldo em aberto, vencido, baixas alocadas e a distribuição por status. Valores parciais são tratados pelo saldo restante; baixas alocadas estão identificadas como valores dos títulos ativos, sem afirmar que sejam entradas bancárias no período. Cancelados aparecem em contagem separada, fora dos totais ativos.

Filtros são criação do título no dia de São Paulo e cliente. Tipo de documento, categoria de despesa e centro de custo não filtram esta carteira, conforme texto da interface. Filtro de todo o período envia limites nulos; datas explícitas são preservadas. Consulta inclui responsável na chave de cache e oculta dados anteriores durante atualização ou erro. Títulos inválidos indisponibilizam todos os valores; não são convertidos em zero. Pendências sem data válida são explicadas mesmo quando existe filtro temporal.

Contrato valida centavos com BigInt, compatibilidade entre nominal/baixado/aberto, vencido menor ou igual ao aberto, contagens por status e correspondência dos totais com o gráfico. O desenho usa proporção apenas para a barra; valores financeiros exibidos mantêm precisão integral. Consulta sem paginação ou limite de títulos.

Invalidações adicionadas à criação/edição de títulos, baixas, correções, faturamento, ciclo de faturas, controle de cargas, ciclo de fechamentos e atualizações fiscais CTe/NFSe. Nenhum fluxo fiscal ou pagamento foi reimplementado. A tela informa explicitamente que os demais indicadores ainda usam consultas limitadas, enquanto as próximas frentes substituem esses indicadores.

Validação: 7 testes próprios de cliente/interface e 14 testes receivableFinancialFrontendDatabase passaram. Lint dos arquivos e hooks alterados não encontrou erros; warning pré-existente any em usePollCteStatus linha 17 preservado. TypeScript global sessão 78349 passou; verificação final 41834 registrada na integração do coordenador. Root validou também a consulta contra schema com casos reais de banco. Nenhuma migration editada nesta frente.
