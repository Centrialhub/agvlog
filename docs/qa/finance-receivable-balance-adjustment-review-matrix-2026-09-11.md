# Baixa residual: matriz de revisão independente

## Requisitos e escopo

O plano09/09 exige componentes explícitos para desconto/tarifa/retenção, sem ajustar silenciosamente nominal ou extrato (linha129); distingue desfazer vínculo, correção e devolução real (131). Cancelamento confirmado com recebimento preserva dinheiro e transforma somente recebimento efetivo em crédito (165–179). Confirmação manual e evidência da baixa estão em198–204, concorrência em413. O item11.2.3 (linha471) exige expressamente desconto/perda: ambas classificações pertencem ao requisito original. Não tratar classificação contábil como automática.

Core proposto pelo autor: journal append-only apply/reverse, kinddiscount/loss, effective_on/request/actor/reason/revision e auditoria. _receivable_ledger_evidence net inclui cash+credit+adjustment para projeções legadas; snapshot deve separar componentes. Nenhum INSERT de payment/bank/movement por desconto/perda. Nenhuma fonte fiscal emitida/cancelada via provedor por este ensaio.

## Matriz concreta

| Cenário | Invariante esperado |
|---|---|
| Nominal100, cash60, discount40 | Nominal100 original; cash60; discount40; settled100/open0; banco/pagamentos byte-idênticos ao antes do ajuste |
| Nominal100, credit30, loss70 | Cash0; credit30; loss70; settled100; nenhum dinheiro criado |
| Aplicações parciais e múltiplas | Soma ativa nunca excede aberto; excesso/zero/negativo rejeitados sem evento/audit residual; apply parcial<=open e reverse parcial<=saldo ativo confirmados pelo autor |
| Reversão de ajuste | Evento compensatório, original intacto; reabre somente ajuste; não devolve dinheiro nem libera crédito por inferência |
| Reversão de cash após ajuste | Somente cash é devolvido; ajuste/crédito continuam separados; novas revisões refletidas |
| Cancelamento fiscal/comercial cash60+credit30+discount10 | Reverte10, libera30 e cria crédito novo somentecash60; zero novo bankentry; compensações idempotentes e atômicas |
| Cancelamento após ajuste integral sem cash | Nenhum crédito artificial de valor descontado/perdido |
| Replay e revisão obsoleta | Mesmo request/payload retorna resultado original; payload diferente ou revisão antiga rejeita, sem duplicação |
| Identidade e acesso | Empresa/ator atuais, motorista inclusive misto negado; revogação durante espera e replay negados |
| Data/período | effective_on finita, política temporal explícita; corte encerrado preservado, reabertura se exigida; data anterior à origem documental comprovada rejeitada; manual usa criação em São Paulo; reversão não antecede o ajuste original |
| Auditoria | Eventos manuais visíveis na auditoria central; compensações fiscais actorNULL exigem evidência de observação válida |
| Fontes inválidas | Grafo invoice/closing, fiscal pendente, origem divergente, prova ledger inválida bloqueiam ajuste; não converter null em zero |
| Carteira/página/forecast | Cash+credit+discount+loss=settled; settled+open=nominal para ativos; cancelados sem aberto; previsão não estima cash sobre parcela ajustada |
| Disputas | Ajuste×receive, ajuste×credit, ajuste×reverse e cancelamento nas duas ordens, uma revisão vencedora; limites compartilhados preservados |

## Infraestrutura e limites

Helper independente createReceivableBalanceAdjustmentReviewDatabase emsrc/test/helpers/receivableBalanceAdjustmentReviewDatabase.ts: fullrefund04822+corecredit01312+carteira04429+bulk13458, com funções/tabelas reais e oracle escalar pré-bulk apenas como referência de fixture. Nenhum candidato de ajuste instalado até contrato enviado pelo autor. Banco PostgreSQL local livre no início desta tarefa; ensaio nativo só após freeze e coordenação de exclusividade. Não aplicar nada remotamente.

Esta matriz é preparação, não evidência de conclusão. Resultados reais serão acrescentados após os testes; não inferir aprovação da nova funcionalidade a partir de testes anteriores.

Worker real12756: bloco EXCEPTION por job preserva observação e marca retry/review quando projeção falha. Ensaio de período encerrado deve comprovar status fiscal verdadeiro/observação preservados, financeiro inalterado e diagnóstico durável; não testar apenas exceção isolada do process_fiscal_observation.


## Evidência executada em 11/09/2026

Core congelado: `20260911115046_finance_receivable_balance_adjustments.sql`, SHA256 `86428df46295f943412638fc4af2527c9b2fcc7040cdb51ccd705955ac051e49`. Nenhum SQL de produto foi alterado nesta revisão.

- `receivableBalanceAdjustmentReview.test.ts`: **8 PASS**, saída 0, início 09:27:30, duração 4,12 s. Caixa60/desconto40/reversão parcial/replay; estorno real de caixa preservando perda; stale e revogação; cancelamento fiscal confirmado gerando crédito apenas sobre cash60; fechamento anterior imutável com compensação datada hoje; falha injetada no journal preservando verdade fiscal e retry; datas anteriores à origem e ao ajuste recusadas; fatura/fechamento cash90+desconto10 pagos, reversão5 reabre5 e públicos preservam composição, sem novo banco.
- `test-balance-adjustment-native.mjs`: **6 PASS**, sessão22836, saída0, PostgreSQL17.11 descartável confirmado parado. Desconto×recebimento nas duas ordens, desconto×crédito nas duas ordens, revogação durante espera financeira e trava de linha anterior ao comando. Sobreposição das disputas verificadas por `pg_blocking_pids`; caso NOWAIT exige40001. Só o recebimento real cria entrada; crédito reduz apenas a capacidade aplicada. Replay não duplica ajuste.
- ESLint dos três arquivos TS e dois scripts nativos: saída0.
- Revisão independente15916/TS: nenhuma divergência concreta encontrada em null/legado, redução única do aberto ou supressão/reaparecimento da pendência de agenda. Teste integrado de forecast pertence à raiz e não é contado nos14 casos acima.

### Limites explícitos

A matriz anterior inclui cenários planejados; não se deve interpretar cada linha como teste executado. Os14 casos acima são a cobertura desta revisão, complementada pelas provas do autor e da fronteira pública da raiz. Concorrência nativa usa escritor privado como proprietário com identidade autenticada real; não substitui os testes públicos de ACL. O cenário invoice/closing começa de um grafo sintético coerente e usa os comandos reais para receber/ajustar/reverter; não afirma ter criado a fatura pelo comando de faturamento nesta prova.

Fechamento bancário real de ontem permite compensação hoje no período aberto e mantém o snapshot antigo byte a byte. Reversão manual datada no período fechado foi negada. A prova de retry fiscal usa CHECK adicional exclusivamente local (rollback), mantendo guardas de produto; demonstra atomicidade do worker, não uma exceção real de fechamento hoje. Nenhum documento fiscal foi emitido ou enviado ao provedor.

A fixture precisou restaurar DDL/funções reais ausentes: captura fiscal atual, worker12756 e eventos, defaultsCTe/provider_document_version/issued_at, fiscalbasis/cents, contextos públicos/audit capturados, client_invoice_details e closing.lifecycle_revision. As primeiras falhas de pré-requisito foram corrigidas apenas na fixture. A primeira expectativa temporal de exceção na prévia foi substituída por contrato real elegiblefalse + escritor negado, mantendo a asserção de nenhum resíduo.
