# Imagens e comprovantes adicionais de gastos

Integração local concluída em 11/09/2026. Root informou que 42754, 44437 e 44823 foram aplicadas após o ensaio hospedado. Este agente não executou deploy nem escrita remota.

## Fluxo entregue

O novo upload financeiro aceita a origem `expense_item`, identificada pelo gasto canônico existente. O original é preservado no bucket de quarentena; JPEG/PNG passam pelo reprocessamento WASM com os mesmos limites do ensaio. Só o derivado com hash próprio é finalizado como utilizável. PDF/planilhas e imagens recusadas permanecem em quarentena, com explicação. Não há declaração de antivírus.

Falha ao carregar ou verificar o runtime não finaliza um resultado falso: o original permanece privado e o mesmo pedido pode ser retomado. Resultados de validação já finalizados permanecem imutáveis. Uma imagem recusada por dimensões ou recursos deve ser reenviada em uma versão menor; o arquivo original não é substituído.

Em FinanceExpenses, o detalhe do gasto apresenta o painel de comprovantes adicionais. O usuário envia o arquivo, confere o estado, informa motivo e confirma o anexo separadamente. A RPC de anexação não muda custo, obrigação ou dinheiro. O painel mostra ator, data, motivo e identificação do artefato; a justificativa de ausência no registro original permanece visível. A contagem adicional do reader é opcional para compatibilidade de apresentação, sem inventar status em respostas antigas.

Recuperação: WebLocks e armazenamento por empresa/ator/gasto preservam pedido exato antes do envio. Rejeição conhecida na primeira tentativa libera revisão; rejeição após resposta incerta mantém o pedido original. Registro de outra janela nunca é apagado por uma confirmação concorrente. Falha de atualização da lista após confirmação não transforma sucesso em resultado incerto nem permite novo envio automático.

Visualização: novo action `finance_artifact_preview_v2` reautoriza o artefato e exige origem `expense_item`, gasto exato e derivado sanitizado. Assina apenas `upload-validated` com o cliente autenticado, mantendo RLS. Original, bucket legado e artefato de outro gasto são recusados antes de assinar. A URL dura 300 segundos e não é persistida; troca de empresa/ator/gasto desmonta o estado de visualização.

## Evidência

Rodada final: 21 testes em 6 arquivos passaram, processo 52556 encerrado com código 0. Inclui tela de histórico (4), painel de anexo e sucesso com falha real de refetch (2), outbox com incerteza/corrupção/outra janela (3), autorização de preview (2), contrato (3) e workflow de upload/imagem/quarentena (7). Lint dos arquivos alterados: zero erros. Testes UI usam transporte controlado; a validação WASM hospedada é a evidência separada do root em `finance-image-hosted-benchmark-2026-09-11.json`. Não houve TSC por este agente.

Manifesto do secure-upload: 18 arquivos, 75.196 bytes, SHA256 `f35cdc57ca58ad3be3e3ef5c7927baed40e7f724a85fcd422214e1bc88cb712c`. Arquivo `secure-upload-deploy-files-2026-09-11.json`. O deploy e o ensaio final de anexação com Storage real são responsabilidade do root; não são alegados por este relatório.