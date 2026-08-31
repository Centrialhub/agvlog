# Despesas — publicação coordenada e contenção

Estado: procedimento e artefatos locais, ainda não executados em produção. Não autoriza promover toda a árvore de trabalho, que contém alterações simultâneas de outros módulos.

## Escopo e pré-condições

O lote de criação depende do lote de revisão auditada de despesas e da cadeia operacional/financeira anterior. Conferir versões, corpos, privilégios, triggers e dados legados antes de escolher o conjunto de migrações. A candidata não é uma migração independente para aplicar sobre qualquer banco.

A versão a publicar deve incluir a [correção forward de MFA](DESPESAS-MFA-2026-08-30.md). A inspeção de comprovantes usa o JWT verificado do usuário, sem EXECUTE para service_role; o gateway antigo é incompatível com essa mudança. Não publicar o contrato anterior sem MFA nem restaurá-lo como rollback.

Na publicação, suspender submissões e concluir as requisições antigas antes de revogar os escritores legados. Banco, gateway secure-upload e frontend precisam usar os contratos novos em conjunto. Não liberar a tela enquanto o backend estiver incompleto. Manter histórico e leitura de comprovantes disponíveis.

Confirmar bucket receipts privado, comportamento real dos metadados escritos pela Storage API, scanner configurado e gratuidade de cada serviço usado no teste. Nenhuma chamada fiscal, pagamento, envio externo ou ativação SSX faz parte deste ensaio. Não testar scanner pago por presunção de gratuidade.

Confirmar uma sessão autenticada de motorista e outra da operação por meio seguro, sem senhas no chat. A conexão de navegador do agente falhou antes de abrir o painel nesta etapa; Auth hospedado, Axe real e smoke autenticado permanecem pendentes.

## Contenção e retomada

- [Suspender criação com MFA](EXPENSE-MFA-CONTAIN-2026-08-30.sql): revoga create_driver_expense_command, inspect_expense_receipt_upload e recalculate_manual_expense_settlement tanto em public quanto em expense_creation_private. Não apaga linhas, objetos, pedidos ou comprovantes; não restaura escritores antigos.
- [Retomar criação com MFA](EXPENSE-MFA-RESUME-2026-08-30.sql): exige o estado suspenso e restaura apenas os grants esperados para authenticated. Não restaura service_role, corpos antigos ou acesso sem MFA; não altera dados financeiros.
- Os dois scripts verificam 27 funções, seus privilégios/configuração, três triggers, três constraints e três políticas restritivas de leitura MFA. Exigem proprietário de banco e rejeitam divergências sem alteração parcial. Isto não substitui a revisão completa do schema e do release. Scripts EXPENSE-CREATION anteriores permanecem como artefatos históricos e recusam esta versão por incompatibilidade.
- Uma trava exclusiva impede a mudança enquanto uma transação de criação/contexto/probe/recálculo está ativa. Esses endpoints tomam a trava compartilhada e verificam a liberação novamente dentro da função. Um frame privilegiado iniciado antes da contenção não deve passar pela guarda após a suspensão.
- A trava do banco não cobre o tempo de um upload HTTP já autorizado. Parar novas submissões e aguardar os uploads em andamento continua obrigatório. Um objeto eventualmente recebido sem despesa permanece preservado; estes scripts não fazem limpeza.
- Histórico e consulta de comprovante permanecem disponíveis. Revisão administrativa e demais operações financeiras não são suspensas por estes scripts; usar sua contenção específica se o incidente também as afetar.

Pedidos com resposta incerta ficam na fila original. Durante a suspensão, a recuperação informa indisponibilidade e não descarta o pedido. Depois da retomada, o usuário recupera o mesmo request_id e corpo; uma despesa já confirmada não é criada novamente. Nunca limpar localStorage, excluir auditoria, sobrescrever comprovante ou usar a RPC legada para forçar o reenvio.

## Aceite após publicação

1. Motorista registra valor exato com comprovante válido; operação recebe uma única despesa pendente. Sem comprovante exige motivo explícito.
2. Operação aprova ou rejeita com motivo e prévia atual. Motorista vê a decisão. Recálculo manual mantém os itens e só inclui reembolso aprovado, sem pagamento automático.
3. Resposta perdida e recarregamento recuperam a mesma solicitação; conferência SQL confirma uma despesa e uma auditoria.
4. Outro tenant, outro motorista, associação de comprovante divergente e acesso à RPC legada são negados no backend.
   Owner/admin em AAL1 também são negados em contexto, criação, replay, recálculo, comprovantes e leitura direta. AAL2 permite apenas o acesso do papel. Promoção de operador durante espera ou scanner deve causar nova autorização.
5. Contenção preserva os registros e arquivos; retomada recupera o resultado sem duplicação. Alterações de contrato ou transações em andamento fazem o procedimento recusar a execução.
6. Repetir chegada/saída/entrega, baixa operacional, acerto, faturamento e portal; verificar que nenhuma transição ou pagamento foi provocado pelo simples registro da despesa.
7. Repetir Axe, teclado e zoom no navegador real. Testes de componentes/SQL locais não equivalem a esse aceite.

Resultados locais são registrados em [MFA nas despesas](DESPESAS-MFA-2026-08-30.md) e, historicamente, em [criação recuperável](DESPESAS-CRIACAO-RECUPERAVEL-2026-08-30.md). As pendências gerais permanecem em [correções prioritárias](CORRECOES-PRIORITARIAS-2026-08-29.md).
