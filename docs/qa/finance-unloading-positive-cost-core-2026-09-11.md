# Correção positiva do custo da descarga — núcleo privado

Estado: núcleo local revisável, sem promoção pública ou aplicação remota nesta entrega. SQL `20260911060519_finance_unloading_cost_amendments.sql`, SHA256 `85df0dba24b4dfd938114d8b91df78f36c14eaeffe71e64b5d89a813d619dc6c`.

O journal append-only mantém o mesmo expense/payable/charge. O custo original continua intacto; resolver fornece custo vigente e cadeia por autor, motivo e request. O pagável recebe somente o novo nominal e status pending; approved exige reaprovação explícita. Recebível, cobrança e movimentos permanecem preservados. Tickets privados exigem OLD/NEW exatos, ator e transação. O escritor reautoriza depois das travas e antes de replay/escrita. Evento `unloading_cost_corrected` integra auditoria manual.

Não retifica custo com histórico de pagamento/alocação ou materialização protegida. Fechamento ativo bloqueia; reabertura comprovada permite reavaliar. Custos sem amendment conservam a semântica de complemento: custo500/alocação300/pagável200. Custos retificados têm pagável integral e rejeitam nova alocação direta até existir comando coordenado adequado. Resolver permanece verificável após aprovação/pagamento legítimos posteriores; pagamento passa a bloquear uma nova correção.

Evidência local em `src/test/unloadingCostCorrection.test.ts`: 6 testes PGlite passaram em 2026-09-11 03:26:53, lint0:

- Cadeia150→120→180, approved→pending, replay, originais intactos e cancelamento posterior180.
- Lote real500/300/200 com pagamento antes da instalação, lote anterior pago depois e lote/pagamento criados depois do núcleo.
- Revisão stale, edição nominal sem ticket, perfil misto, falha de auditoria com rollback de pagável/journal/ticket, conflito de replay e imutabilidade.
- Pagamento canônico120 após retificação: versão continua válida, próxima retificação bloqueada; nova alocação direta rejeitada.
- Extrato, cobertura, abertura, revisão de corte, fechamento e reabertura reais: bloqueio sob fechamento, elegibilidade após reabertura.
- Builder real de acerto materializa150: correção do custo bloqueada, acerto e itens preservados.

Preview privado é normalizado removendo `_evidence` somente para validar o DTO safe planejado; o wrapper público ainda é responsabilidade da promoção. Resultados são validados pelos schemas de produção `unloadingCostCorrectionPreviewSchema` e `unloadingCostCorrectionResultSchema`. A fixture usa a cadeia financeira compartilhada e amplia tabelas do acerto a partir do baseline real; isso não prova toda a aplicação, Auth hospedado, concorrência nativa ou pipeline de custódia.

Integração obrigatória antes de liberar:60700 readers/KPIs/acerto/carteira/snapshot do pagamento, wrapper seguro público e UI. Essas partes estão com agentes distintos. Nenhuma alteração nas migrações já implantadas53349/54915. Não afirmar cobertura de retificação com dinheiro já pago nem de materializações fechadas: esses casos continuam bloqueados aguardando resolução auditada própria.
