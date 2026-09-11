# Abertura por contagem física — interface

Implementação local, sem alteração SQL por esta frente. `CashOpeningForm` e `AccountOpeningEvidence` complementam `AccountOpeningReview`, compartilhando consulta, histórico e reversão auditada. A coordenação expõe o painel também pela página Movimentações, independente de extrato.

O tipo da conta é lido de `bank_accounts` por empresa+ID e validado com Zod. Conta física ativa oferece contagem; banco mantém somente a origem OFX. Conta inativa permite histórico, sem nova contagem. Consulta do cadastro com erro/em atualização não autoriza nova abertura. Nenhuma inferência pelo nome da conta.

Contagem por 13 denominações BRL e quantidades inteiras entre zero e 999999999. São preservadas inclusive linhas declaradas com zero. Não aceita repetição, denominação desconhecida ou quantidade fracionária. Soma usa BigInt; confirmação valida o total devolvido pelo servidor contra o pedido exato. Custodiante, data de início do dia em São Paulo e motivo são obrigatórios. Revisão precede o envio. O texto explica que contagem posterior não comprova a posição de início do dia.

Pedido persistido antes do envio por empresa+usuário+conta, usando a mesma recuperação da abertura bancária. Período original, contagem e custodiante prevalecem ao retomar após mudança do intervalo. Resposta perdida não gera outro pedido. Contagem não cria movimento de caixa, não é entrada de receita e não fecha período.

Histórico identifica banco/contagem e conserva discriminação e custodiante após reversão. O contrato exige evidence_type coerente com evidence, total da discriminação coerente com balance_cents e mesma effective_from, inclusive no histórico desfeito. Evidência incompatível é recusada pelo adaptador.

Validação final: 22 testes passaram nos cinco arquivos cashOpeningClient, cashOpeningReview, accountOpeningClient, accountOpeningReview e accountPeriodReview. Incluem conta incorreta/inativa, revisão, resposta perdida, período original, armazenamento, quantidades inválidas, total confirmado, preservação pós-reversão e incompatibilidade tipo/soma/data da evidência. ESLint passou. TypeScript passou na sessão 86716 antes dos últimos refinamentos de contrato; coordenação executa verificação integrada final.

Não houve publicação remota ou navegador real. Contagens posteriores, fechamento físico, diferenças e transferência de custódia permanecem fluxos separados.
