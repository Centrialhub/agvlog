# União local de atualizações preparadas — 2026-10-05

O usuário autorizou a mesclagem imediata em worktree próprio, preservando originais, sem réplica mutável, push, merge remoto ou deploy. A árvore técnica unida antes deste registro é 22551be1b4e49856840ee54c7f66968179ed7ee0, tree a27c1459560c78e386b451bf7b79253793eba246. O SHA efetivamente testado e logs serão registrados externamente em C:/Users/Thomaz/Documents/Codex/2026-10-01/task/merge-20261005/local-checks.json; não atribuir resultados antigos a esta união.

## Inputs fixados

| Input | SHA | Conteúdo |
| --- | --- | --- |
| Publicado de referência | 63278f7ef77dd1c4e0db7d9e7219ca48280ee18a | Hotfixes NFS-e/frete publicados; release.json verificado na organização/preflight |
| Integração inicial | deda6fd1fa765648f8de1785a1a7693081ad11bb | Publicado e organização local |
| Manual preservado | f46e72020ffbed5d1a27dc73a85b40b7bc9a6736 | 10 arquivos: navegação imediata, filtro imported_at/fuso, seleção em lote e união de grupos antes de criar carga |
| Amplo | 340e6db55dc61fb513778bbe8d779a193db0f396 | Frontend, correções financeiras já existentes no amplo, nove fontes Edge, 27 migrations, CI/baseline e testes |
| Frete | 8cd53a7938ffaae9b604cb97ad9ecfec60d307f3 | Cálculo automático de fontes sem frete, preservação manual/persistida, guards e testes; código produtivo igual8547 |

Amplo/frete têm merge-base a0c9771cf7db2d6a65819a2252cd8fb2344dd869 e 44/12 commits exclusivos. O amplo não inclui a sequência publicada até632; a união retém todos os três inputs como ancestrais. Refs refs/preserved/manual-prepared-20261005, prior-wide-20261005 e prior-freight-20261005 fixam fontes. Bundles e hashes ficam em merge-20261005/inputs.json. Os 10 arquivos manuais continuam sujos, sem alteração de conteúdo/index/HEAD no diretório do usuário; handoff foi registrado no coordenador, que encerrou a reserva antiga e atribuiu a nova tarefa prepared-updates-20261005/CodexMerge.

Não foram incluídos o financeiro isolado de45d927f79aa03e43d0b89266b059f30a3a5361 nem o forward incompleto/não commitado 20261001191500_restore_driver_own_operational_expenses.sql. As correções financeiras que já pertencem340 permanecem, sem importar o pacote de atribuição do cliente faturado CT-e de45.

## Resoluções

- Merge amplo a11037938d1eabe0b154beda528ead5894ff9c75: conflito add/add em AGENTS.md. Retidas a entrada atual e as instruções completas de domínio; escopo desta união prevalece sobre referências históricas de checkout/ambiente.
- Merge frete22551be1: conflitos add/add em ctePreviewDraft.ts, edgeFunctionError.ts e ingestionEdgeError.test.ts. Preservados os blobs8cd exatos desses arquivos e também CteEmissionPreviewDialog.tsx/Ingestion.tsx: diferenças produtivas eram imports/brancos; o teste do frete acrescenta erro vazio/message.
- periodUnloadingFlow manteve1005 escritores, ANALYZE periódico da fixture rollback-only e timeout180s que já constava340. Nenhuma assertion/quantidade foi reduzida. Esta fixture não foi executada nesta frente.
- Lockfiles amplo/frete são idênticos. Todos os 10 blobs do pacote manual foram verificados intactos após os merges. O motor calculateFreight é idêntico a0/340/632/8cd; totalValue dos grupos manuais é valor dos produtos, não fallback de frete fiscal.

## Revisão e testes permitidos nesta frente

Dois subagentes fizeram revisão somente leitura: contratos manuais e reconciliação amplo/frete. Nenhum bloqueador novo de regra de negócio foi identificado. CTe2000 e Ingestion1730 estão abaixo dos caps2185/1768 sem alterar limites. NewLoadDialog962 já pertence à lista histórica de arquivos grandes; não houve aumento de caps. O coordenador ganhou operação de merge externo com input pinado, worktree atribuído, contexto/lease conferidos e ambos os pais preservados; seus10 testes locais passaram antes de usar a operação.

A próxima rodada usa Node22/npm10.9.4, dependências do lock em node_modules próprio, configurações públicas fictícias, poucos workers e somente testes/checks locais. Nenhum segredo/env do usuário nem serviço da réplica deve ser reutilizado. Logs e versões ficam fora da árvore versionada; gate da fila cobre coordenação Git, não aprovação de SQL/aplicação.

## Aceite pendente e bloqueios de entrega

1. Executar os92 testes manuais, regressões fiscais/frete e checks estáticos na árvore unida; resultados externos por SHA. Homologar navegação/menu/perfis reais e imported_at/fuso, seleção fora das25 linhas, capacidade, separação, recuperação e uma única carga persistida com IDs únicos.
2. União de destinos com fornecedores diferentes: preservar cálculo por NF/remetente, impedir soma parcial quando uma fonte falha. PendingDocsGrouping possui lacuna preexistente de consulta de flags fiscais/attempt; conferir rejeição autoritativa no RPC e ausência de replanejamento inválido. Não alterar contrato implicitamente para aprovar testes.
3. A frente de testes anterior ocupa a réplica. Reservar ambiente/fixtures depois, testar o mesmo SHA/contrato combinado, forwards revisados, RPCs/permissões/RLS/Edge, rollback compatível e navegador autenticado. Não aplicar cegamente as27 migrations nem reexecutar histórico contra produção/réplica atual.
4. O baseline/CI amplo antigo (327 tabelas/oito buckets, pacote privado pin501f7...) não equivale automaticamente à réplica atual de13schemas. Reconciliar schema, ownership/ACLs, manifesto e execução de forwards no baseline atual antes dos gates database-and-e2e. Os31 erros SQL/quatro falhas de motorista são resultados históricos e precisam de resultado atual ou correção de contrato validada; o forward incompleto preservado não é uma solução pronta.
5. CI validate, todos os shards unit-tests e database-and-e2e, mais build/smoke e retorno do mesmo candidato continuam necessários. Não marcar READY/build/testes unitários como produção validada.

O commit único de entrega será preparado numa branch isolada a partir do publicado reconciliado somente após validar a árvore combinada. Preservar commits/refs/bundles de trabalho e equivalência de tree hashes; não squash/rebase branches compartilhadas. Publicação permanece fora desta autorização local.

## Diagnóstico do primeiro gate no Windows

No288686ae, pipeline:174PASS/5FAIL/1SKIP de plataforma. Os5FAIL do fixture histórico foram causados por CRLF retido em três migrations antigas após introduzir .gitattributes eol=lf. Normalizar apenas CRLF→LF produz exatamente os blobs Git aprovados; não houve driftSQL por merge. O loader da fixture em memória agora usa LF. A assertion negativa foi fortalecida para exigir rejeição da segunda função get_finance_account_period_evidence_page, comprovando o rollback da primeira. Nenhuma migration, guard, manifesto, permissão ou assertion funcional foi retirada/relaxada. SHA256 do patch preservado:6455b4bdc2ae6a9afdf008f202b534771a12721e9b7ff2db773a779182926163. Reteste e SHA novo registrados externamente; não reinterpretar o primeiro gate como aprovado.

## Elegibilidade no agrupamento

A consulta de grupos pendentes omitira tentativa anterior e sinais de emissão. O RPC já recusava uma nota emitida com tentativa anterior, impedindo criar toda a proposta. O agrupamento agora consulta os quatro campos e reutiliza canSelectDocumentForNewLoad antes de formar grupos, contagens e totais. Emitida sem tentativa continua disponível. É uma lacuna preexistente, identificada no aceite operacional, corrigida sem migration nem alteração de RPC. O teste usa cliente Supabase real com transporte controlado e retorna somente as colunas projetadas: reproduziu três falhas antes da correção e passou para CT-e, referência de saída e NFS-e; cobre união sem escrita, totais, refetch e IDs enviados. Logs/SHA de execução externos. Homologação nativa e extensiva do mesmo SHA continua necessária.
