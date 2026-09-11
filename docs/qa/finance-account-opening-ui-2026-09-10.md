# Abertura bancária auditada — interface

Painel independente `AccountOpeningReview` em `AccountPeriodReview`, acessível mesmo se a comparação principal do período falhar. Contratos e adaptador próprios; nenhum SQL/ledgerClient alterado por esta frente.

O valor da abertura não é digitado: a interface exibe saldo e arquivo OFX com âncora no dia anterior ao corte, fuso Brasília UTC−03:00. O pedido envia apenas conta, período, revisão das evidências e motivo. O usuário revisa antes de confirmar. Mudança da revisão consultada após essa etapa bloqueia confirmação até nova revisão.

Mostra saldo calculado pelos movimentos registrados e aviso explícito de que não confirma saldo bancário nem fecha período. `opening.evidence_status=requires_review` mantém snapshot visível com advertência de revisão. Histórico preserva autor/ID, data, motivo, saldo/corte e autoria da reversão; identificação manual aparece em texto e cor. A correção não apaga nem movimenta dinheiro.

Recuperação persistida por empresa, ator e conta, incluindo tipo de comando. Pedido anterior prevalece mesmo se o usuário mudar o intervalo de consulta. Rejeição SQL conhecida na primeira tentativa permite nova revisão; pedido previamente incerto continua preservado. Armazenamento corrompido ou inacessível bloqueia novos envios. Consultas com erro/em atualização não apresentam dados antigos como atuais.

Validação: 10 testes passaram (5 workspace, 3 cliente e 2 AccountPeriodReview), incluindo resposta perdida de abertura/reversão, mudança do período, data/fuso da âncora, revisão alterada, histórico, armazenamento, primeira rejeição e pedido incerto. ESLint passou. TypeScript global reportou somente erro externo em `src/pages/driver/DriverDeliveries.tsx:335`: `operational_event_id` ausente na variante queued de DeliverySubmissionResult; coordenador informado, arquivo não alterado.

Limites: regras e revalidação autoritativa são do RPC da frente de banco. Não fecha período, não integra automaticamente histórico legado, não gera movimento bancário e não substitui contagem de caixa físico. Nenhum deploy ou navegador real nesta entrega.
