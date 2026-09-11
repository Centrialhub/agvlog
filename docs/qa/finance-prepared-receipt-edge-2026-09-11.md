# Preparacao de comprovante de lote - Edge e leitores

Candidato local integrado ao contrato SQL64852 em desenvolvimento. Nao publicado separadamente.

- quarantine-workflow e uploadArtifactContract aceitam expense_draft: identidade source_id permanece a intencao; reserva autorizada precede qualquer escrita.
- Preview de comprovante agora consulta get_finance_expense_receipt_artifacts com o JWT do usuario. Seleciona exatamente um vinculo e confere tenant/expense/artifact; ramo draft exige receipt_intent_id igualsource_id. Artefato isolado sem consumo nao e prova suficiente para assinar URL. Legadoexpense_item permanece compativel semintencao.
- Cliente readExpenseArtifacts valida o mesmo vinculo e aceita o campo opcional receipt_intent_id no historico.
- Nao houve mudanca de formatos ou liberacao de PDF. Original continua emquarentena; derivado somente JPEG/PNG pelo metodo existente.
- Adapter authorize cleanup passou a async/await para satisfazer interface Promise, preservando fluxo e resultado.

Validacao:11testes quarantineWorkflow/uploadArtifactContract;3preview;8preparedClient/outbox/panel;8cleanup. Total30testes passaram nas rodadas separadas, lint direcionado0. Deno check secure-upload/index.ts com config propria passou apos corrigiradapterPromise. Nenhum teste autentica no ambiente remoto nem executa o novoSQL, ainda emintegracao. Testes de workflow usam dependencias simuladas; nao afirmar validacaoEndToEnd por eles.
