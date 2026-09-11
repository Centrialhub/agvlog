# Aprovação revisada da obrigação

A prova nativa anterior encontrou um erro real: uma aprovação genérica iniciada vendo50 podia esperar a correção do custo e aprovar20 sem nova confirmação. A candidata85400 fecha esse caminho. Migrações81653 e83307 permanecem inalteradas.

`20260911085400_finance_payable_revision_approval.sql`, criada pela CLI, SHA-256 `e73cccc830084d57d72f707c722c909125f93f58be2ae91c2153a55296ea7aba`. Sem aplicação remota nesta tarefa. A sequência evita uma janela sem guard:81653 privado →85400 →83307 e promoção final guardada pelo root.

## Contrato e proteção

A prévia pública `preview_finance_payable_approval(tenant,payable)` retorna identidade tenant/actor/payable, revisão, obrigação normalizada, cost_origin quando aplicável, blockers e capacidade. A revisão incorpora a linha inteira da obrigação e a versão econômica corrente. O frontend deve preservar a revisão e o valor realmente mostrados.

`approve_finance_payable(payload)` aceita version1, tenant_id, request_id, payable_id, revision, amount_cents e reason. Usa locks fiscal→finance→payable, reautoriza membership/motorista antes do replay e antes da atualização, compara revisão e valor, registra evento/comando auditados e preserva toda a moeda/história existente. O resultado inclui approval_event_id, identidade, valor, aprovado_em, cost_revision e cash_changed=false. A data/ator são produzidos no servidor.

O ticket privado temporário é vinculado a txid/tenant/payable/actor/request e OLD/NEW completos. O trigger consome o ticket uma única vez e permite apenas status, approved_at, approved_by e updated_at. UPDATE raw que promove complemento corrigido81653 a approved é negado, mesmo se tiver aguardado o row lock da correção. Outros status/valores continuam protegidos pelos guards existentes. Obrigações sem esse journal mantêm a aprovação raw anterior para compatibilidade; a API revisada também atende essas obrigações, permitindo um único fluxo de UI. Nenhum bypass GUC ou acesso público aos tickets/helpers brutos foi criado.

## Provas locais

`src/test/payableRevisionApproval.test.ts`:4 testes aprovados com parsers de produção payableApprovalPreviewSchema/ResultSchema. Cobrem revisão antiga50 rejeitada40001, raw negado pelo guard, nova revisão20 aprovada, replay, pagamento real20, rollback integral quando o evento falha, tenant/misto/revogação, acesso anônimo/helpers negado e compatibilidade de obrigação sem retificação. ESLint limpo. A captura de catálogo executou adicionalmente apenas o positivo selecionado, sem representar outra suíte completa.

`node --experimental-strip-types scripts/test-finance-open-complement-native.mjs`: sessão55886, saída0,8 casos aprovados/0 findings, PostgreSQL17.11 parado e PID removido. Os hashes de81653/85400/83307 foram verificados antes/depois. Nenhuma definição SQL foi editada durante o runtime.

- Aprovação raw aguardando a correção agora falha com finance_payable_approval_revision_required e mantém20pending.
- API com revisão exibida50 aguarda e falha40001; nova prévia20 aprova legitimamente.
- Pagamento50 antigo é negado depois da correção; reaprovação e pagamento20 reais funcionam.
- Pagamento primeiro impede correção obsoleta40001.
- Aprovação primeiro invalida a prévia de correção40001.
- Materialização/acerto nas duas ordens e row-first da obrigação mantêm seus resultados seguros já documentados, sem dinheiro alterado.

A prova anterior de seis sucessos e um finding continua registrada em finance-open-complement-native-2026-09-11.md/json; seu bloqueador foi resolvido por esta candidata e reensaio. Não reclassificamos o comportamento antigo como correto.

## Limites

Testes locais não equivalem a browser/Auth hospedado ou aprovação de deploy. O frontend deve usar confirmação e outbox com revisão/valor preservados, sem refetch seguido de aprovação automática. Root mantém responsabilidade pela promoção final que verifica também o novo guard. A coordenação de alvo menor ou igual à alocação continua como etapa seguinte; esta aprovação não cancela obrigação nem libera capacidade.
