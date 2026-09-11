# Associação de peça comprada diretamente — UI (2026-09-10)

Ação por peça no painel de componentes da OS. MaintenanceDirectPartAssociation usa contexto específico61828; não usa total do cabeçalho ou parcela de mão de obra. Escolha explícita de custo/fornecedor por IDs, quantidade digitada e documento digitado, mais declaração de compra direta sem consumo de estoque. Quantidade compara decimal exato sem ponto flutuante. Documento deve coincidir com o custo selecionado. Vínculo de estoque ou incompatibilidades do servidor bloqueiam escolha.

Revisão combinada fonte/alvo obrigatória; alteração de documento/fornecedor/revision invalida confirmação. Pedido preservado por empresa/ator/peça antes do envio. Resposta incerta retoma payload original, incluindo quantidade/documento/classificação. Armazenamento corrompido bloqueia decisões; primeiro rollback conhecido libera nova revisão. Reversão conserva dinheiro, obrigação, origem e autoria do vínculo.

Consulta paginada com busca literal, vínculo ativo fora da página e histórico permanente. Nenhuma criação de custo, pagamento ou consumo. Invalidações incluem contexto da peça, mão de obra, inventário e componentes da OS, além dos escritores físicos existentes e lote canônico.

Validação: 11 testes passaram (4 fluxo, 3 cliente, 2 painel, 2 inventário); lint do escopo sem erros. Sem TSC próprio desta etapa; último integrado81790 falhou somente em oito erros externos ao financeiro. SQL/schema real coordenado pelo root. Nenhum SQL ou banco remoto alterado nesta frente.
