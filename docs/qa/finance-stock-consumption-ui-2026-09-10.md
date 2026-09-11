# Consumo de estoque: interface de atribuição

Entrada por peça com movimento de estoque explícito no painel de componentes da OS. Compras diretas continuam em fluxo próprio. Seleção por IDs de aquisição, com quantidades textuais positivas e até 100 origens distintas, preservada entre páginas do servidor.

Conferência obrigatória pelo servidor antes da decisão: quantidade e valor por aquisição, saldo antes/depois, total atribuído e valores operacionais declarados. Divergência exige declaração adicional explícita. Zero centavos atribuídos é válido; nenhum cálculo usa Number para quantidade ou centavos. A regra proporcional e os resíduos são exibidos, sem alegar FIFO, custo médio ou nova despesa.

Revisão final vinculada à revisão calculada e ao contexto consultado; fonte alterada, erro ou atualização pendente bloqueiam confirmação. Pedido persistido antes de enviar e retomado integralmente após resposta incerta. Corrupção local bloqueia novas decisões. Rejeição conhecida na primeira tentativa libera nova conferência. Reversão integral usa revisão atual, mantém autoria/motivo/linhas históricos e não devolve material ao estoque.

Invalidações em criação/alteração de estoque/manutenção e associação da aquisição mantêm as consultas financeiras atualizadas. Não há criação de custo, pagamento ou movimento físico na interface. SQL e testes reais permanecem sob propriedade dos agentes de banco; nenhuma implantação remota.

Validação em andamento: testes próprios de contrato, cliente e UI cobrem múltiplas páginas, quantidades de alta precisão, eco/identidade do preview, confirmação de discrepância, recuperação, dados obsoletos, corrupção e reversão. Root confirmou quatro testes SQL reais com os schemas desta entrega.

Validação da interface: 10 testes próprios de consumo passaram; regressão conjunta com aquisição passou (21 testes, incluindo preço unitário fracionário). Lint final aprovado. Eventos de aquisição/consumo e suas reversões possuem rótulos legíveis no histórico financeiro. Checagem integrada de tipos em andamento sob handle87942.

TSC integrado87942 concluído: código0, nenhum diagnóstico. Log finance-stock-consumption-ui-tsc.log vazio. Nenhum TSC próprio permaneceu ativo.
