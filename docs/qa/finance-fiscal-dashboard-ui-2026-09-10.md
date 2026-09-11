# Painel financeiro sem agregações de amostras

Financial agora apresenta três consultas independentes: carteira de títulos ativos, custos na cobertura incorporada e títulos fiscais incorporados. Foram removidas as consultas limitadas de documentos CT-e/NFS-e, suas somas locais e a lista de últimos documentos usada como amostra. A previsão de fretes de NF ainda não faturadas permanece explicitamente indisponível até a consulta própria; não foi substituída por zero.

O resumo fiscal usa somente finance_fiscal_receivable_origins, com data de incorporação em São Paulo. Expõe ativos, cancelados e em revisão, bruto, retenções e líquido; não afirma representar caixa, todos os documentos emitidos ou toda a receita histórica. O contador de processamento pendente é rotulado como empresa inteira, todas as datas e clientes. Falhas e fontes inválidas não exibem valores zero, e dados antigos ficam ocultos durante atualização.

Filtros são aplicados explicitamente: datas/clientes para carteira; datas/clientes/tipo para fiscal; datas/categoria/ID do centro de custo para custos. Categoria usa catálogo com rótulos em português, sem exigir códigos do usuário. Centros incluem inativos para histórico. Rotas de despesas registradas e movimentações foram verificadas em AppRoutes. O contrato fiscal confere escopo, contagens, bruto menos retenções, somas por tipo/mês e nulificação global em caso de fonte ativa inválida.

Invalidações explícitas de custos e fiscal foram adicionadas aos fluxos de folha, títulos, despesas manuais, pagamento de acerto, lotes de despesas, atualização CTe/NFSe e ciclo de faturas, preservando lógica operacional existente.

Validação: 21 testes próprios de carteira/custos/fiscal e integração de filtros passaram. Lint não encontrou erros; warning pré-existente any em usePollCteStatus linha 17 preservado. TypeScript final sessão 2997 está registrado com o coordenador. SQL e testes reais das projeções fiscais/custos pertencem às outras frentes, sem alteração de migration nesta entrega.
