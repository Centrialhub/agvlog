# Prévia de cancelamento de despesa avulsa

A migração20260910181549 expõe a prévia pelo ID do título a pagar, verificando acesso financeiro, empresa e existência da origem antes de chamar o contexto da81257. O contrato conserva separadamente payable_id e original_request_id; o ID do pedido original não substitui o ID do título. can_execute representa acesso e eligible representa as condições verificadas no servidor.

Três testes PGlite passaram usando record_finance_manual_expense e cancel_finance_manual_expense reais e o parser da interface. Cobrem identidade original preservada após cancelamento, duas despesas de mesmo valor sem troca de origem, rejeição do pedido usado como título, empresa alheia e motorista inclusive com papel administrativo. O cancelamento mantém autoria e motivo e não cria movimentos ou itens de despesa duplicados. ESLint dos arquivos próprios aprovado.

A invalidação compartilhada passou a incluir a prévia de despesa avulsa. Criação e atualização de títulos usam a empresa retornada pela mutação para atualizar consultas dependentes, inclusive quando a interface já mudou de empresa.

Validação nativa81257+81549 está atribuída ao agente de PostgreSQL, incluindo a inversão de locks identificada na revisão. Auditoria manual está em integração separada. Testes parciais não comprovam migração integral, sessão de navegador ou implantação remota.

Atualização: seis testes nativos concluíram com saída0 e servidor parado; o coordenador conferiu log e hashes de81257/81549. As duas disputas adversariais entre UPDATE com lock de linha e cancelamento com lock financeiro retornaram40001, preservaram rollback e concluíram sem deadlock. Auditoria182406 também integrada: ambos os cancelamentos aparecem no filtro manual, com autoria/motivo/data/ID permanente. Rodada integrada do coordenador passou os quatro testes atuais deste reader e seis testes da infraestrutura/histórico de movimentos, total10. TSC48196 passou antes das alterações posteriores do histórico de movimentos.
