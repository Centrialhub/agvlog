# Correção do frete na pré-emissão de CT-e — 29/09/2026

## Identidade e estado

- Solicitação: preenchimento automático de frete ausente e dificuldade de informar/transmitir o valor manual na versão pública atual.
- Fonte pública conferida por HTTPS em `https://agvlogistica.vercel.app/release.json`: release `17a7592dca01f31b1aa7b63340fbaf28bb116347`, build `fecb84c9daaa7348`, data embutida `2026-09-23T17:23:14-03:00`.
- Base do candidato: `bb9e5d51`, branch `codex/production-stability`, PR #3. Os quatro arquivos de prévia, agrupamento, builder e hook de emissão não tinham diferenças em relação ao SHA publicado antes desta correção.
- Estado: **corrigido no candidato; não publicado**. Nenhuma emissão fiscal real, mudança SQL ou publicação Edge nesta rodada.
- Commit das correções de código: `4492eb78b454faaa9b11aabfaf81a060e92dfbb0`.

## Causas verificadas no código

1. `buildGroups` soma `freight_value` já persistido nas notas. A prévia copiava essa soma sem executar o calculador quando uma nota estava sem frete.
2. O campo numérico controlado executava `toFixed(2)` a cada render e convertia a entrada a cada tecla; não preservava texto incompleto ou vírgula decimal.
3. O builder dá prioridade ao componente explícito `freight_weight`. A edição do campo principal não sincronizava esse componente nem recalculava a base/valor ICMS, permitindo enviar um valor antigo da composição.
4. A inicialização reiniciava os rascunhos quando cadastros chegavam ou ao repetir a consulta de padrões. O carregamento assíncrono também precisava distinguir uma limpeza manual de um zero original.

O relato individual ainda não veio acompanhado do valor esperado, erro ou resultado do provedor. Os defeitos acima são reproduzidos pelo código/testes; não se afirma que todas as falhas de transmissão tenham a mesma causa.

## Mudanças restritas

- Ao abrir a prévia, calcula somente notas sem frete positivo, usando o calculador existente e o contexto de cada nota. Mantém os valores salvos e overrides; não grava NF nem recalcula notas com valor já informado.
- Uma falha não produz soma parcial utilizável: o frete fica sem valor válido e a tela informa o motivo, permitindo correção manual do grupo. Cadastro necessário indisponível não é substituído silenciosamente por outro cliente.
- Entrada aceita `1234,56`, `1.234,56` e `1234.56`, conservando a digitação até sair do campo. Entrada vazia/inválida invalida o valor anterior.
- Campo principal e componente Frete Peso passam a representar a mesma base. Recalcula ICMS pelas regras já existentes; não altera alíquota, regime ou regra de soma de componentes.
- Respostas atrasadas, recarregamento de padrões e atualização dos cadastros não apagam a edição manual, inclusive quando o usuário limpa o campo.
- Edição bloqueada enquanto a prévia está em transmissão ou já foi transmitida. Preservada a reserva fiscal e o despacho do snapshot persistido; uma operação anterior incompatível continua exigindo reconciliação.

O frete base continua distinto do total da prestação quando existem componentes adicionais ou ICMS somável. Esses campos seguem as regras existentes do builder; esta correção não redefine o cálculo tributário.

## Evidência — 29/09, 13:34–13:37 UTC

- 74 testes passaram em sete arquivos: 65 sobre pré-emissão/frete/builder/despacho e nove do contrato de chat já existente.
- `ctePreviewFreightDialog.test.tsx` monta o diálogo real e verifica autofill, erro visível, digitação durante resposta atrasada, limpeza e retry sem perda. Cadastros/consulta oficial e calculador são simulados nesse teste.
- `ctePreviewFreight.test.tsx` executa parser, composição, preenchimento e builder reais; verifica soma de notas, falha parcial, override, formato brasileiro e atualização do ICMS.
- `cteFreightTransmission.test.tsx` executa hook e builder reais até a chamada de despacho, com RPC/provedor simulados. Confere `1234.56` no snapshot e em `vTPrest`/`vRec`, e ausência de despacho diante de snapshot conflitante.
- Suítes existentes `cteBuilder`, `freightCalculator` e falha de padrões continuam aprovadas.
- ESLint dos nove arquivos envolvidos: zero erros e zero avisos. Revisão pela skill React: componente monetário separado, rascunho preservado, dependências de efeito controladas e campo rotulado.
- O typecheck inicial também encontrou uma tipagem ausente no teste de políticas de chat da rodada anterior; foi adicionada a tipagem da linha consultada, sem mudança SQL ou de comportamento. A suíte correspondente passou 9/9.

## Pendências antes da publicação

- Testar fluxo autenticado no ambiente local, incluindo confirmação dos valores exibidos com composição e ICMS.
- Conferir o caso relatado com valor esperado e mensagem/resultado observado; integrações fiscais de produção não são usadas como teste automático.
- Cumprir o Quality gate e o roteiro de promoção. A homologação local e o CI ainda têm pendências documentadas no log de 28/09; esta suíte não aprova o ambiente público.

## Retorno e prevenção

Mudança de frontend, sem migração de dados. Antes de promover, registrar deployment anterior e candidato. O retorno deve respeitar snapshots fiscais já reservados; não apagar reservas ou fabricar nova identidade para tentar novamente. Manter os testes de edição assíncrona, valor composto e despacho nesta suíte para mudanças futuras.

## Ampliação: falha no motor compartilhado — 29/09, 13:37–14:00 UTC

O usuário relatou falhas em outros módulos e confirmou que o fornecedor/remetente da NF-e determina a tabela. O cadastro de tabelas já oferecia fornecedores (`is_supplier = true`), enquanto os consumidores enviavam o `client_id` do destinatário ao mesmo critério. Essa divergência era compartilhada pela importação, carga, geração e recálculo fiscal.

Consultas **somente de leitura** em produção, sem dados identificáveis no registro:

- 13 tabelas: 12 bloqueadas, uma ativa/vigente. A ativa restringe fornecedor; as bloqueadas restringem grupo.
- 161 regiões, todas gerais em relação a cliente (`client_id IS NULL`). O filtro anterior `.eq('client_id', destinatário)` excluía essas regiões.
- 167 NF-es vigentes criadas nos últimos 30 dias: zero correspondem ao cliente da tabela ativa pelo destinatário; **121 correspondem pelo CPF/CNPJ do remetente e fornecedor da mesma empresa**. As 46 restantes não possuem correspondência com a tabela ativa nessa configuração.
- Todas as 167 têm fornecedor cadastrado pelo documento do remetente; nenhuma apresentou múltiplos fornecedores correspondentes. 136 já têm frete positivo salvo, o que não comprova o cálculo atual.

Alterações adicionais:

- Separados `supplierId`, identidade do remetente e identidade do destinatário. Resolução central por CPF/CNPJ completo e empresa, sem aproximação por nome. Grupo padrão vem do fornecedor.
- Importação passa o remetente original; pré-emissão/recálculo de NF usa a identidade da nota; operações agregadas leem os remetentes das NF-es de origem, sem usar o emitente do CT-e.
- Simulador separa fornecedor de destinatário, remove sugestão arbitrária da primeira região e valida fornecedor contra as NF-es selecionadas. Workbench envia contexto de entrega e vincula resultado ao contexto da seleção.
- Regiões gerais são elegíveis, regiões específicas compatíveis têm prioridade, empates e erros de consulta retornam falha explícita. Restrições de empresa, bloqueio, vigência e tabela permanecem.
- Importação informa frete pendente e motivo, preservando o salvamento da nota. Não foram alterados cadastros, fretes históricos, bloqueios de tabela ou regras tributárias.
- [Contrato permanente](freight-calculation-contract.md) e orientação em `AGENTS.md` adicionados para impedir nova confusão entre destinatário e fornecedor.

Verificação ampliada: **133 testes passaram em 26 arquivos**, execução iniciada às 13:57:26 UTC, duração 18,63 s, Node 22.23.2/npm 10.9.4. Comando: `npm run test -- src/test/freight src/test/ctePreviewFreight src/test/cteFreightTransmission src/test/cteBuilder src/test/cteEmissionDefaultsFailure src/test/cteWorkbench src/test/generateCte src/test/loadFreightContext src/test/inboundFreightRecalculation src/test/fiscalDocumentAtomicFreight src/test/ingestionSafety src/test/ingestionCsvSafety src/test/ingestionPostCreateFailure`.

A suíte nova executa resolução de fornecedor, motor e pré-emissão reais com transporte de banco simulado, incluindo isolamento, documentos excluídos, paginação e falha parcial. Algumas suítes históricas verificam apenas código-fonte; não são apresentadas como prova de execução integrada. Typecheck passou. ESLint focado passou sem erros/avisos na rodada ampliada. Smoke autenticado e Quality gate de publicação continuam pendentes.

Conferência final do código registrado: 133/133 novamente às 14:00:10 UTC, duração 19,13 s; typecheck e ESLint dos 18 arquivos focados concluídos com exit 0. `git diff --cached --check` passou após remover uma linha vazia extra no parser monetário. A revisão preservou as alterações ainda incompletas de infraestrutura local fora deste commit.
