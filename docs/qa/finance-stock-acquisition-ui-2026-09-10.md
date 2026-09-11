# Aquisição de estoque: interface financeira

Entrada disponível em Despesas registradas → custos antigos → aquisições de estoque. O inventário consulta todas as entradas pelo servidor, com busca/paginação de 30 e contagens completas. Datas ou valores inválidos permanecem visíveis, sem somas inferidas.

Associação exige entrada explicitamente declarada como compra, custo existente selecionado por ID, fornecedor cadastrado, quantidade/documento conferidos, declaração expressa e motivo. A revisão usa a versão do contexto; mudanças e falhas de consulta bloqueiam envio de uma revisão antiga. Não cria dinheiro, obrigação ou custo e não altera o escritor físico.

Pedido preservado por empresa, ator e entrada antes de enviar. Falha incerta permite somente retomar o mesmo pedido; corrupção local bloqueia novas decisões. Rejeição transacional conhecida na primeira tentativa libera nova revisão. Histórico e autoria manual permanecem visíveis. Reversão usa revisão atual e bloqueia dependências não resolvidas, sem estornar a compra.

Validação: 9 testes próprios de cliente/UI/inventário passaram, incluindo recuperação, corrupção, declaração, mudança de revisão, resposta fora do contexto, reversão dependente e contagem de 1.005 origens. Lint dos arquivos da entrega passou. Root validou quatro testes SQL com schemas reais e comandos de associação/reversão.

Atribuição de consumo à aquisição será um fluxo específico; este painel não certifica saldo físico nem adota política de custo médio/FIFO. Nenhuma implantação remota.

Complemento final: quantidade decimal positiva aceita sem limites artificiais de escala, preservando o texto do pedido; alinhamento aplicado também à compra direta da OS. 18 testes integrados (11 aquisição/inventário e 7 peça direta) passaram; lint final passou. TSC 47512 terminou com oito erros externos em DeliveryReceipts e testes de e-mail de recibos, por campos supplierKey/cover de trabalho concorrente. Nenhum diagnóstico em arquivos financeiros desta entrega; ver finance-stock-ui-tsc.log. O TSC anterior 86497 havia passado antes dessas alterações externas.
