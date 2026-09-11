# Confirmação de invalidação manual — UI — 2026-09-10

A lista de movimentos abre a conferência existente. Quando a consulta atual autoriza, o operador informa motivo, revisa o efeito no saldo registrado e confirma explicitamente. A ação invalida a representação do movimento; não executa transação bancária nem apaga o original.

## Escopo e arquivos
- `MovementVoidConfirmation.tsx`: confirmação, pedido durável em localStorage por empresa/ator/movimento, retomada e validação da resposta contra ator, pedido original e efeitos preservados.
- `MovementCorrectionReview.tsx`: integração com prévia escondida durante atualização/erro e componente com chave de escopo.
- `MovementCorrectionDialog.tsx`: texto do fluxo atualizado.
- `movementVoidConfirmation.test.tsx`: testes de perda de resposta, retomada, primeira rejeição conhecida versus rejeição após incerteza, corrupção, escopo, ator/origem incompatíveis, concorrência entre abas, sucesso e falha de atualização de cache.

Contrato e cliente do comando foram fornecidos pelo coordenador e não foram alterados nesta entrega. O pedido original é preservado após resultado incerto. Outra aba não tem seu pedido sobrescrito ou removido; o servidor continua responsável pela proteção transacional concorrente.

## Verificação
12 testes passaram nos três arquivos de UI (`movementVoidConfirmation`, `movementCorrectionReview`, `movementCorrectionEntry`). ESLint dos quatro arquivos alterados passou. TSC inicial 85446 terminou 0; execução final 8594 também terminou 0 após revisão dos campos persistidos (log finance-movement-void-confirmation-tsc-final.log). Nenhuma implantação remota.

Sucesso confirmado permanece visível mesmo se a atualização das listas falhar, e impede outra confirmação sobre a prévia anterior. Os estados de consulta pendente/erro não apresentam elegibilidade antiga. Pedidos já incertos permanecem retomáveis mesmo quando a consulta não está disponível.
