# Log de release — retirada de notas e exclusão de carga

## Identidade e estado

- Responsável: Codex. Alvo: AGVLog, `qcvnsdrbcchaxvawcngk`.
- Base publicada: `e947c6c1d24b20edf80b999dd44baef6a42fbdd8` (release anterior verificado).
- Candidato: branch `codex/fix-grouped-load-creation-20261116`; SHA e PR registrados na promoção.
- Estado: preparado para Quality gate completo; publicação condicionada ao resultado.
- Escopo fechado: frontend; nenhuma migração, Edge, emissão fiscal ou remoção de dados reais como teste.

## Estado anterior e plano de retorno

- Postgres/Edge permanecem sem alteração. Retorno: promover o frontend anterior. Os leitores anteriores já interpretam os resultados das mesmas APIs.
- O botão Cancelar Carga mostrava apenas um aviso para um menu inexistente; não executava cancelamento.
- A tabela de notas não oferecia retirada; apenas o painel de itens permitia solicitar a operação documental.
- A nova ação explica a liberação das notas, solicita confirmação e motivo, preserva os documentos fiscais e respeita o resultado `load_removed`. Não inventa um status cancelado nem promete excluir cargas com dependências.
- Carga em espera exige liberação explícita da trava. Exclusão de carga vazia usa versão esperada e a API de agregado existente. Notas com evidência/fiscal/viagem são avaliadas pelas proteções existentes no servidor.

## Contratos conferidos no alvo em 17/11

| RPC | Argumentos | MD5 definição | authenticated / anon |
| --- | --- | --- | --- |
| apply_load_aggregate_command | _payload jsonb | 9b8e9a34b52a6834911c74796aeff98a | sim / não |
| change_load_documents_v2 | _payload jsonb | 04f99c0e049f773476cba4117beb5f19 | sim / não |
| get_load_document_change_context | _tenant_id uuid, _load_id uuid, _document_ids uuid[] | d09bf96b873bde7c0827cddaefeb5a9f | sim / não |

## Evidências locais

- `npm run typecheck`: passou.
- ESLint dos quatro arquivos alterados: passou; `git diff --check`: passou.
- Vitest: `documentChangesFrontendDatabase`, `documentChangesDatabase`, `documentChangesOutbox`: **50 testes passaram**.
- Teste novo executa a nova ação → confirmação com motivo → SQL real em PGlite sintético, conferindo nota preservada sem vínculo e carga vazia removida. Outro garante que a espera não é removida silenciosamente.
- Fixtures locais descartáveis, sem GoTrue/HTTP nativo; o Quality gate hospedado inclui os contratos e E2E completos. Nenhum teste local é declarado como aprovação de produção.

## Pendências antes de promoção

- Quality gate: validate, oito shards unit-tests e database-and-e2e no mesmo candidato.
- Conferir SHA no alias Vercel e interface autenticada sem executar remoções reais.
- Junção de grupos permanece investigação separada, sem mudança neste delta.

## Orientação operacional

Atualize a página. Para uma encomenda, use a ação Retirar da carga na linha da nota e confirme o motivo. Para liberar a carga inteira, use Excluir carga / Liberar notas e revise a confirmação. Os documentos ficam disponíveis para nova programação; a carga vazia só é removida se as regras e os vínculos permitirem. Em espera exige Liberar Travas.
