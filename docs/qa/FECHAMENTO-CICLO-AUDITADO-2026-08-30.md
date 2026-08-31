# Ciclo auditado de fechamento e reserva de cobrança — candidato local

Estado: implementado e conectado à página **somente no código local**. Não publicado. Não encerra o financeiro nem a prontidão integral do aplicativo motorista.

Continuação local: [recebimentos, estornos compensatórios e reconciliação auditada](RECEBIMENTOS-ESTORNOS-AUDITADOS-2026-08-30.md). O texto abaixo registra o estado e os testes deste lote anterior; os caminhos de pagamento legados foram substituídos na continuação, ainda sem publicação.

## Contrato entregue

- Migração `20260830174819_audit_closing_lifecycle_and_charge_claims.sql`, dependente do [rascunho atômico](FECHAMENTO-ATOMICO-2026-08-30.md) e da cadeia anterior. Recusa reaplicação; não executar isoladamente sobre produção.
- `get_closing_report_action_context` fornece estado, revisão, vínculos e ações autorizadas para o ator/empresa. `apply_closing_report_action` exige ação explícita, motivo, revisão esperada, identificador único e corpo versionado. A API verifica papel ativo novamente após aguardar a chave da requisição.
- Fechar: somente rascunho/em conferência sem vínculo financeiro, com origem atual e validada. Cancelar: somente rascunho/em conferência/fechado/enviado sem vínculo financeiro ou recebimento. Reabrir: somente administrador, de fechado/enviado/cancelado para conferência, também sem vínculo financeiro. Registrar envio preserva faturado e apenas registra envio já realizado; não envia mensagens.
- Estado, revisão, histórico antes/depois, reservas e confirmação durável são gravados na mesma transação. Falha ao persistir a confirmação reverte tudo. Repetição de uma requisição confirmada retorna o resultado original, não representa uma nova leitura do estado atual. Mesma chave com corpo diferente é recusada. Registro idempotente é append-only e legível apenas pelo ator autorizado.
- RPCs legadas de fechar, cancelar, reabrir e registrar envio deixam de ser executáveis pelos papéis API. Helpers novos não têm execução pública; tabelas novas têm grants explícitos e RLS. Não há novos acessos baseados em metadados editáveis do usuário.

## Proteção contra duplicidade e integridade financeira

- Cada item de frete positivo reserva a combinação empresa/nota/tentativa. Índice parcial único impede duas reservas ativas; locks compartilhados pelos pontos de entrada financeiros recusam contenção sem manter gravação parcial. Itens de valor zero não representam cobrança e não criam reserva.
- A verificação inclui outros fechamentos anteriores à migração: registros já fechados/faturados ou com vínculos/recebimentos impedem uma cobrança repetida. Não há deduplicação automática, exclusão nem reescrita retroativa de histórico financeiro.
- A reserva verifica cobrança ativa do CT-e vinculado em `client_invoice_charges`; o caminho inverso, inclusão/reativação de cobrança de CT-e nesse módulo, verifica reservas da tentativa original das notas. Essa proteção **não equivale a conciliação completa de todas as modalidades fiscais ou cobranças manuais**.
- Cancelamento/reabertura elegíveis liberam reservas, preservando a linha original, autor e data de liberação. Uma reserva liberada não pode ser alterada novamente nem apagada. Um relatório já vinculado a fatura/recebível ou com recebimento exige conciliação; a ação administrativa não libera suas reservas.
- Vínculos financeiros existentes não podem ser removidos/trocados silenciosamente. Novos vínculos e alterações de totais recebidos verificam o recebível/fatura canônicos. Estados pago/parcial exigem valores coerentes. Isso não cria ainda um fluxo completo de cancelamento/estorno financeiro.
- Faturamento e registro de recebimento continuam usando as RPCs canônicas existentes. Há teste real de fatura, recebível, recebimento parcial/final, duas baixas e duas linhas de ledger bancário em banco sintético, sem comunicação bancária. **Pagamento idempotente, recuperação de resposta perdida de pagamento e sincronização bidirecional com ações realizadas diretamente em contas a receber continuam pendentes.**

## Interface e recuperação

- A página usa um diálogo com ação inicialmente vazia, motivo obrigatório e consulta atualizada de permissões. Não reaproveita o estado da listagem como autoridade. Não oferece cancelar/reabrir quando há vínculos financeiros; reabrir não é oferecido a operador comum.
- A fila persiste o pedido antes do envio, separada por ator/empresa e versão. Web Locks evitam envio concorrente entre consumidores compatíveis; o servidor garante exclusividade entre sessões. Escrita tem timeout de 30 segundos e confirmação validada contra o pedido.
- Sem armazenamento durável ou Web Locks, não transmite nova ação. Contexto trocado não recebe resultado da sessão anterior. Resposta incompatível/incerta mantém a chave; o painel global recupera o mesmo corpo após remount. Falha definitiva no primeiro envio libera a fila; uma requisição anteriormente incerta continua preservada caso a recuperação seja negada. O procedimento assistido para esse último caso ainda precisa ser concluído, sem descartar a requisição às cegas.
- Motivo, destinatário e canal podem permanecer no armazenamento local até a confirmação. A fila não contém tokens ou credenciais. Registrar envio deixa explícito que nenhuma mensagem é realmente enviada.

## Verificação

- **17 testes SQL**: transições/replay, rollback tardio, duplicidade entre relatórios, liberação imutável, reabertura administrativa, versão antiga/chave divergente, ACL/RLS, reentrega sem preço, envio repetido, fatura canônica, recebimentos parcial/final, vínculos preservados e fixture independente com duas notas/R$ 100 de frete.
- **10 testes React com SQL real**: ação/motivo obrigatórios, resposta perdida/remount, revisão antiga, origem reservada, cancelar/reabrir, opções restritas para faturado, indisponibilidade de armazenamento, troca de tenant/ator e registro de envio sem integração externa.
- **7 testes de fila**: persistir antes de transmitir, confirmação divergente, rejeição definitiva versus pedido incerto, transmissões simultâneas, bloqueio de nova ação, versão/escopo inválidos e troca de sessão durante a resposta.
- A primeira execução geral encontrou uma colisão do nome local `confirm` com a regra estática que proíbe diálogos nativos. Renomeado para `submitAction`, sem relaxar a regra; os 13 testes focais de diálogo/tela passaram depois do ajuste.
- Os dois primeiros ensaios nativos demonstraram que os dados sintéticos herdados tinham frete por nota igual a zero e não serviam ao rateio fiscal sem revisão. O cenário usa agora cliente/carga/duas notas/CT-e sintéticos independentes, com frete por nota positivo conhecido. O novo teste SQL confirma total de R$ 100 e duas reservas, sem alterar snapshots nem retirar revisão histórica.
- **217 ensaios PostgreSQL 17.11 nativos aprovados**, dez novos: migração/ACL sem mutação operacional, fechamento idêntico concorrente, duplicidade após commit, fonte fiscal bloqueada, cancelamento concorrente, disputa de reservas ainda não confirmadas, bloqueio de cobrança de CT-e por outro módulo, concorrência no sentido inverso, revogação de papel durante espera e rollback tardio da confirmação. Processo terminou com código zero; cluster descartável em loopback encerrado. Diagnósticos locais preservados em `node_modules/.cache/qa-postgres`.
- Gate geral final aprovado com código zero: **1.964 testes em 158 arquivos**, tipos, lint geral/crítico, baseline estrutural, sintaxe das 40 Edge Functions, build e scanner de artefato público. Node 22.23.2/npm 10.9.4. Lint focal estrito sem avisos e `git diff --check` aprovados. Maior chunk: 488,3 KiB, abaixo do limite de 500 KiB. Nenhum processo deste lote permaneceu em execução.
- Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções. Não representa o aplicativo inteiro nem todos os arquivos novos. O lote anterior de rascunho atômico tinha 1.930 testes/155 arquivos e 207 casos nativos.
- SHA-256 da candidata SQL: `dd38a8be1314caef81cf7f3a2cbe35d1cd029cd5e29e822b62e5d0fed5cfcd71`. Migração de rascunho atômico preservada: `6ddceefdcf0fa323be38533762b12fce25560fca9034afac93659890874e1cc9`.
- Advisors locais tentados com `supabase db advisors --local --type all --fail-on error`: `ECONNREFUSED 127.0.0.1:54322`. Nenhuma stack Supabase local ativa. Testes de catálogo/RLS não foram apresentados como advisors completos ou paridade do ambiente hospedado.

## Antes da publicação

1. Concluir idempotência dos pagamentos, conciliação de fatura/recebível, cancelamentos/estornos e alterações feitas pelos outros módulos financeiros. Preservar documentos, recebimentos e evidências existentes.
2. Ensaiar todas as rotas de cobrança: CT-e preexistente/cancelado/reativado, vínculos fiscais alterados, representação outbound/NFS-e e serviços manuais. Concluir a precificação explícita de novas tentativas e a resolução de fontes sob revisão.
3. Preparar contenção e retomada coordenadas. Não restaurar RPC insegura, apagar confirmações/reservas/histórico nem publicar apenas o frontend sobre backend incompatível.
4. Fazer preflight restrito e E2E autenticado das jornadas interligadas. Não repetir a exportação/DDL amplo anteriormente rejeitado. Credenciais somente por canal seguro; não pedir senha no chat nem criar atalho de autenticação.

Escopo já identificado para o próximo lote financeiro: `useRegisterClosingPayment` e `useGenerateInvoiceFromClosing` invalidam somente a lista de fechamentos; `useFinancialPayments` registra/estorna recebíveis e invalida recebíveis/baixas/banco, mas não os fechamentos; `useCancelClientInvoice` invalida faturas/recebíveis/elegibilidade fiscal sem atualizar fechamentos. Revisar também os corpos locais de `register_receivable_payment`, `reverse_receivable_payment` e `cancel_client_invoice`: as rotas legadas não compartilham a confirmação durável desta etapa e o estorno legado remove linhas. Definir uma única ordem de locks, sincronização de estados, razão/auditoria imutáveis e recuperação para todas as entradas antes de liberar esse conjunto. Esse mapeamento é de código local, não uma nova verificação remota.

Skills Supabase/PostgreSQL orientaram grants, RLS, validação e locks; React orientou estado isolado por sessão e recuperação versionada. Nenhuma alteração em produção, emissão fiscal, transferência, mensagem externa, serviço pago ou chamada SSX foi realizada neste lote. SSX permanece inativo.
