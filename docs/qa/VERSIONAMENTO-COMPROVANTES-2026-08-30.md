# Versionamento de comprovantes — candidata local

Estado: **implementado e testado localmente; não publicado. Não conclui correção ou reentrega.**

Atualização posterior: a camada seguinte implementa a [correção auditada da mesma tentativa](CORRECAO-AUDITADA-ENTREGAS-2026-08-30.md), também local. Reentrega e preservação dos arquivos no Storage continuam pendentes. Os números abaixo são a evidência histórica do lote de versionamento.

## Comportamento

A candidata `20260830120554_version_delivery_proof_evidence.sql` substitui a unicidade global de comprovante por nota por versões positivas e únicas, com no máximo uma versão ativa. Preserva IDs, caminhos, recebedor e demais dados de versões aposentadas. A aposentadoria exige evento de correção/reentrega do mesmo tenant, ator, nota, viagem e parada; requer justificativa. Histórico não pode ser editado, reativado ou apagado pelo caminho normal do banco.

Helpers são privados e executam com os privilégios do chamador. `authenticated` perde DML direto na tabela; APIs canônicas mantêm autorização e bloqueiam o grafo antes de criar a versão. Não se ampliaram privilégios para viabilizar a escrita. As duas views internas usam `security_invoker=true`, sem grants aos papéis API. A revisão Supabase/PostgreSQL orientou essas permissões, a ordem dos locks e o índice da referência ao evento de aposentadoria.

`current_delivery_proofs` filtra tenant, exclusão da nota e vínculo com a carga atual. `available_delivery_proofs` exige também estado uploaded/validated e caminho não vazio. Comprovante manual pendente não significa arquivo recebido. A nova versão recebe outro ID; um reenvio idêntico não cria versão adicional. Comprovante ativo com evidência não é sobrescrito para permitir nova confirmação.

Dezesseis leitores reais foram adaptados: resumo, busca, documentos, PODs, alertas, próximas entregas, relatórios, tracking, status público e detalhes nas versões existentes. As duas APIs de detalhe preservam o endurecimento de privacidade já publicado, expõem comprovantes atuais separados de `proof_history` e mantêm autorização por nota. Download histórico usa o ID original e continua condicionado à permissão atual de download.

As duas buscas chamavam `row_to_jsonb`, função inexistente na fixture e não encontrada no catálogo de produção consultado. O erro foi reproduzido localmente e a candidata usa `to_jsonb`. Isso **ainda não é uma correção publicada** dessas buscas.

## Frontend

`PortalShipmentProofs` diferencia versão atual de versões anteriores e informa que um comprovante anterior não confirma a tentativa atual. A página trata falha/perda de permissão no download sem abrir o arquivo e sem trocar por outro ID. A resposta antiga sem `proof_history` continua válida durante a compatibilidade de publicação.

A confirmação do motorista agora invalida os mesmos caches de composição, operação, financeiro e portal, incluindo `load_documents` e `portal_shipment_detail_v2`. Usa `allSettled`: falha de refresh não transforma commit confirmado em erro de envio. Consultas continuam obsoletas e sujeitas ao retry normal da tela.

## Evidências e limites

- **48 testes específicos:** 34 SQL de versionamento/leitores/permissões, quatro reproduções do legado, quatro da página/hook integrados ao SQL e seis de contenção.
- Um teste adicional de refresh foi incluído no arquivo existente de envio do motorista.
- Gate final com contenção: **1.550 testes/136 arquivos aprovados**, TypeScript, lint, baseline, sintaxe de 40 Edge Functions, build e scanner do artefato público. Maior chunk 488,3 KiB, limite 500 KiB. Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches, 81,81% funções; não é cobertura integral do aplicativo.
- Ensaio nativo final: **150 casos aprovados**, incluindo nove de versionamento/contenção, em PostgreSQL 17.11 descartável; encerramento do cluster confirmado e processo finalizado com código zero. Requisições concorrentes criaram uma só versão; conclusão pelo motorista preservou comprovantes anteriores e um acerto pendente, com zero pagamentos. Contenção foi ensaiada sem chamadas em andamento e não alterou esses registros.
- A primeira execução integral encontrou um teste estático que comparava todas as views com definições apenas do baseline. Ele passou a verificar as migrações ordenadas e foi acrescido teste de `reloptions` no banco real da fixture. Não foi removida a exigência de `security_invoker`.
- Os testes específicos deste lote de histórico usam evento de aposentadoria sintético criado pelo dono da fixture e helper privado. Não testavam a API de correção, acrescentada e testada na camada seguinte; nova tentativa/reentrega ainda não está implementada.
- A fixture usa baseline já versionado e dados sintéticos, sem novo dump/definições de produção. Hashes locais mínimos dos escritores: operação `e2dc86f29af6f7829052887cf83eea01`, motorista `99890a58fb8a6fc9cf0fb025c77f5a85`.
- PGlite e PostgreSQL nativo não substituem pilha Supabase completa, Auth, Storage real, PostGIS ou E2E autenticado. `.env.test.local` continua ausente nesta etapa. Testes de download simulam o transporte de arquivos, embora a autorização SQL seja real na fixture.
- Nenhuma chamada fiscal, pagamento, reativação SSX, serviço pago ou publicação ocorreu neste lote.

## Contenção e publicação

[PROOF-VERSION-CONTAINMENT-2026-08-30.sql](PROOF-VERSION-CONTAINMENT-2026-08-30.sql) substitui apenas os dois escritores de baixa por recusa explícita, preservando dados, leitores versionados e ACLs. Verifica hashes/permissões e recusa divergência ou reaplicação. Não restaura a unicidade global, não apaga histórico e não reabre consultas antigas. Pedidos pendentes conservam as chaves originais para reconciliação após restauração adiante.

**Antes de usar a contenção, suspender novos envios e aguardar requisições em execução.** Substituir uma função PostgreSQL não cancela frames que já começaram. O ensaio é de sistema sem escritores em andamento; não constitui mecanismo de drenagem HTTP nem demonstra interrupção de chamadas já iniciadas.

A recuperação anterior da camada operacional recusa os escritores novos. Isso é intencional: após existência de várias versões, voltar ao schema antigo exigiria perder evidência. Uma restauração funcional precisa de migração adiante revisada, não remoção dos guards de preflight.

Este lote depende de camadas operacionais locais ainda não publicadas. A candidata não deve ser aplicada isoladamente em produção. Falta revisar/cortar todos os escritores legados e ensaiar o conjunto completo e seus consumidores antes de publicação coordenada de banco, Edge e frontend.

## Próximo bloco funcional obrigatório: correção e nova tentativa

1. **Separar histórico de estado corrente por alocação.** Guardar o resultado de cada tentativa e uma relação explícita de substituição/correção. Projeções de paradas, cargas e acertos antigos devem usar sua tentativa, não o status mutável da nota em uma carga futura.
2. **Correção auditada em uma transação.** Exigir papel, tenant, motivo, revisão da versão esperada e resultado corrigido; preservar o resultado anterior, aposentar o comprovante correspondente e recalcular projeções. Não inventar início/chegada/saída nem transformar confirmação documental em movimento físico.
3. **Reentrega como nova tentativa, não reset.** Encerrar a alocação anterior mantendo notas/itens/evidências históricas; liberar uma alocação atual explicitamente selecionada e permitir nova composição/parada. Ajustar despacho, realocação, preparação, motorista e consultas para distinguir vínculos ativos dos históricos. Uma falha não pode deixar a nota confirmada e ainda presa à carga anterior.
4. **Financeiro preservado.** Revisar acertos abertos com auditoria; não reescrever acertos aprovados/pagos nem gerar pagamento, emissão ou cobrança automaticamente. Evitar duplicação de receita/quantidades quando a nota entrar em nova carga.
5. **Substituir os handlers antigos.** A camada seguinte remove `clearDeliveryStatus` e instala correção explícita/recuperável com guard diferido. `confirmRedelivery`, autosave, detecção de pagamento e `saveAll` ainda contêm escritas diretas de status/metadados. Substituir por contratos específicos e requisições recuperáveis; negar caminhos alternativos incompatíveis no backend. Não publicar UI que só aparente uma transação.
6. **Fechar preservação de arquivos.** O código atual de `secure-upload` gera UUID e usa `upsert:false`, mas a limpeza aceita qualquer caminho válido do mesmo tenant sem checar vínculo com evidência. Políticas legadas também permitem DELETE direto em alguns buckets. É achado de revisão local, ainda sem teste Storage autenticado ou exploração em produção. Exigir autoria/posse do upload, bloquear arquivos referenciados por versões atuais ou históricas e tratar corrida entre vinculação e limpeza; checagem isolada antes do DELETE não basta. Não declarar arquivos imutáveis apenas porque as linhas SQL são imutáveis.
7. **Ensaiar o fluxo inteiro.** Corrigir → reentregar → nova baixa → portal/histórico → acerto, com duas sessões concorrentes, perda de resposta, troca de tenant, navegador autenticado e falha entre cada etapa. Só então preparar publicação coordenada, smoke pós-deploy e reconciliação das cargas existentes autorizadas para teste.
