# Conferência administrativa das notas — etapa C local

Estado: **implementada e validada localmente; não publicada**. Depende das etapas A e B de tentativas/reentrega e dos contratos operacionais anteriores. Não aplicar isoladamente ou promover toda a árvore de trabalho.

## Contrato e correções

- `update_load_document_metadata` aceita somente canhoto recebido, forma de pagamento, dois códigos de ocorrência e responsável. Cada nota leva tentativa e revisão; motivo e chave idempotente são obrigatórios. Todos os documentos são validados antes da primeira alteração, em uma transação.
- A auditoria é append-only e registra tenant, ator, carga, nota, tentativa, resultado, motivo e campos anteriores/novos. Papéis API não têm DML na auditoria. Helpers têm revogação explícita; somente a RPC de conferência é executável por `authenticated`, com operador ativo do tenant.
- Ordem de locks: chave idempotente, vínculo de permissão, grafo da viagem/carga e notas ordenadas. Uma contenção ou revisão antiga recusa o lote sem gravar parcialmente. Repetição confirmada retorna o resultado original antes de consultar a composição atual e não reaplica uma conferência à nova tentativa.
- O recebimento de canhoto exige resultado auditado da tentativa. Não equivale a prova de entrega, quitação ou confirmação do cliente. A correção de resultado retira a conferência do canhoto com auditoria; a reentrega limpa canhoto/códigos/responsável e aliases de data, preservando-os no snapshot anterior. Forma de pagamento permanece como metadado comercial, sem criar pagamento ou reutilizar frete.
- Escritores diretos não podem alterar os cinco campos administrativos, nem inventar resultado/data/reentrega da tentativa original. Resultados registrados e aliases de data são protegidos no commit; os escritores canônicos podem terminar sua transação e criar histórico antes da validação diferida. Dados legados não são reescritos pela migração.
- `LoadNotesPanel` não grava mais ao abrir a tela, detectar pagamento ou alterar campos. O operador prepara rascunhos, confere as notas identificadas e confirma o motivo. Não há mais sincronização automática de forma de pagamento da carga usando a primeira nota.
- Rascunhos pertencem ao ator/tenant/carga/revisão. Refetch não os sobrescreve nem transfere para outro resultado/tentativa. Reaplicar sobre valores novos exige ação explícita e só é possível na mesma tentativa/resultado; os demais casos exigem descartar o rascunho e conferir novamente.
- Data/hora de entrega na tabela são somente leitura. Seletores e checkbox receberam nomes acessíveis e bloqueio quando falta contexto válido. Impressão usa dados confirmados, não rascunhos.
- Uma fila local versionada persiste o corpo antes do envio. Recuperação usa a mesma chave/corpo e valida ator, empresa, carga, documentos, tentativas, campos e IDs de auditoria da resposta. Erro incerto ou envelope incompatível não é apagado; um cliente antigo também recusa versão futura. Não há token, comprovante ou JSON completo da nota na fila.

## Evidências e limites

Fixtures PGlite e PostgreSQL nativo usam dados sintéticos e SQL local versionado, sem nova exportação de produção. Testes de UI usam os componentes reais e RPCs contra a fixture SQL; não são E2E autenticado hospedado nem testes visuais/Axe completos.

Testes focados: 23 SQL, 25 de fila/contrato de resposta, 9 de rascunhos e 6 da tela integrada. As telas de baixa/correção também passaram em quatro contratos (anterior, fundação, reentrega e conferência): 44 cenários, 11 novos sem remover os anteriores. O teste inicial da tela tinha expectativa incorreta de status da fixture (`in_transit` em vez de `confirmed`); a expectativa foi corrigida, sem relaxar o contrato. A mensagem de conflito não afirma rollback durante recuperação de pedido incerto; orienta recuperar o pedido existente antes de reenviar.

Uma repetição do gate encontrou timeout global de 5 segundos em um caso da fixture UI/SQL. O arquivo passou isoladamente com os seis cenários entre 176 e 820 ms por teste. O orçamento apenas dessa suíte foi ajustado para 15 segundos, incluindo suas transações WASM e invalidações de UI sob a execução concorrente das outras fixtures. Não foram removidas asserções, adicionados retries ou alterados timeouts de produção. A validação final abaixo considera esse ajuste.

Gate final encerrado com código zero: **1.846 testes em 150 arquivos**, 74 novos em relação à etapa B. Node 22.23.2/npm 10.9.4; tipos, lint de erros/módulos críticos, baseline estrutural, sintaxe de 40 Edge Functions, build e scanner de artefato público aprovados. Lint focado de todas as novas interfaces/hooks e testes também passou com `--max-warnings 0`. Maior chunk: 488,3 KiB (limite 500 KiB). Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções — não é cobertura integral do aplicativo. `git diff --check` passou. Os processos de verificação deste lote terminaram; nenhum ficou em execução.

Ensaio PostgreSQL 17.11 final: **193 casos aprovados**, 11 novos na etapa C. Código zero e cluster descartável encerrado. Os casos novos verificam migração sem alteração de negócio, ACL, revisão/tenant, conflitos reais de nota/permissão, replay simultâneo, chave divergente, escritor legado, imutabilidade, reaplicação recusada e falsificação de aliases de data nas duas tentativas. SHA-256 da candidata efetivamente carregada: `fd2c6fe93058a45870c5a5ee44e10b96247866d8804825e9fe36d9a7b4874fe1`.

As skills Supabase/PostgreSQL orientaram RLS, grants privados e ordem de locks; React orientou rascunhos vinculados ao contexto, armazenamento versionado e revisão explícita. Nenhum serviço pago, emissão/transmissão fiscal, pagamento, mensagem externa ou SSX foi acionado. Nenhum deploy foi feito neste lote.

## Trabalho obrigatório antes de publicar

Avanço posterior: a [fundação de leitura do fechamento por tentativa](FECHAMENTO-TENTATIVAS-2026-08-30.md) está validada localmente, mas não ativada nem publicada. Ela não resolve sozinha o item 2 abaixo: o escritor antigo ainda precisa ser substituído por uma transação idempotente, e exportações/ações financeiras devem ser adaptadas antes de ligar o novo painel.

1. Inventariar os outros escritores de notas e confirmar compatibilidade das regras novas com todos os fluxos de ingestão/edição; o guard protege a API, mas isso não comprova funcionamento de cada consumidor.
2. Adaptar fechamento/relatórios às tentativas históricas. `useClosingReports` e `closingReportBuilder` ainda consultam `delivered_at`, enquanto os escritores canônicos usam `delivery_at`. Consultar apenas `fiscal_documents.load_id` também perde o vínculo da carga anterior após reentrega. Não corrigir isso copiando datas ou valores para a nova prestação.
3. Revisar o escritor manual de totais de fechamento (`cash_to_receive`/`pix_to_receive`) e concluir a revisão de preço/frete/vínculo fiscal da nova prestação. Ele não faz parte desta API de conferência; a preservação de valores no teste não equivale a auditoria integral financeira.
4. Ensaiar contenção/restauração adiante das etapas B/C preservando auditorias, tentativas e pedidos sem resposta. Não restaurar escritores legados ou apagar histórico para reverter a migração.
5. Completar múltiplas reentregas, retirada/reanexação/replanejamento, portal/Storage e acerto, depois preflight e publicação coordenada com testes autenticados frontend/backend. A limitação do ensaio Supabase completo e a rejeição anterior de DDL amplo continuam válidas.
