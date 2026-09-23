# Correções da criação de carga — 22/09/2026

Correções publicadas em https://agvlogistica.vercel.app em 22/09/2026.
Este registro encerra os quatro achados de `load-creation-related-audit-2026-09-22.md`.

## Comportamento corrigido

1. O agrupamento não envia mais o campo de cabeçalho não suportado `status`.
   O banco aceita o valor legado `planned` nesse fluxo para compatibilidade.
2. Notas confirmadas com CT-e/NFS-e emitido podem receber seu primeiro vínculo
   com uma carga planejada, quando não possuem carga, viagem, tentativa de entrega
   ou vínculos conflitantes. Documentos de outra empresa ou de outra carga são
   recusados. Identificadores fiscais e datas de emissão são preservados; os
   bloqueios de replanejamento, remoção e documentos encerrados permanecem.
3. A identidade do pedido agora inclui cabeçalho, documentos, patches e auditoria.
   Uma repetição exata recupera a resposta salva sem repetir efeitos; conteúdo
   diferente com o mesmo identificador é recusado. Falhas revertem toda a transação.
4. Agrupamento e Nova Carga persistem o pedido antes do envio e oferecem
   **Recuperar criação** se a resposta se perder, inclusive após recarregar a página
   ou quando as notas já desapareceram da lista. O armazenamento é separado por
   empresa, usuário e fluxo, com trava entre abas.
5. Sugestões automáticas preservam escolhas manuais de veículo e motorista,
   inclusive a escolha explícita de deixar o campo vazio.

## Publicação

- Código publicado: `66a6bbf8805e8d9aa27307c462544070ad26023d`.
- Branch local: `codex/fix-complete-load-creation`.
- Worktree de publicação: `F:/agvlog-main/.codex-publish/load-creation-release`.
- Base: versão anteriormente publicada `ebf6c46ea77a66305c7b1853d62c0585f087965a`.
  As alterações não relacionadas presentes no workspace principal ficaram fora desta publicação.
- Migrações aplicadas: `20260922192742_fix_grouped_load_initial_status.sql` e
  `20260922195558_harden_complete_load_creation.sql`.
- Deploy: `dpl_FeSysga1zeyAbGT2bKMTDJRsmgTX`, estado `READY`, promovido a produção.
- `/release.json` do domínio público retornou HTTP 200, commit acima,
  `buildHash: bf39054a26168911`, `builtAt: 2026-09-22T19:56:58.000Z`.
- `/loads` e o JavaScript de entrada retornaram HTTP 200 após a promoção.
- Tela de autenticação renderizada no navegador após a publicação.

## Validação

- 81 testes passaram em oito suítes: `loadCreationRelatedAudit`,
  `issuedInvoiceInitialLoad`, `loadCreationRecovery`,
  `PendingDocsGroupingRecovery`, `groupedLoadInitialStatus`,
  `loadAggregateDatabase`, `documentChangesDatabase` e `newLoadDocumentSelection`.
- Incluem SQL real dos comandos/wrappers, composição fiscal e interações React
  para escolhas manuais e recuperação. Na suíte do agregado, a atribuição downstream
  usa fixture; a composição real também é coberta em suíte separada.
- ESLint dos arquivos alterados: sem erros ou avisos.
- Build de produção na Vercel: aprovado.
- `npm run supabase:release:check`: aprovado, 592 migrações ordenadas e 48 Edge Functions.
- Inspeção do banco em produção confirmou os wrappers e a regra de primeiro
  vínculo instalados, RLS ativo no registro privado, ausência de acesso direto
  ao registro e às implementações internas e ausência de EXECUTE anônimo.
- O único novo aviso informativo dos advisors é RLS sem policies na tabela
  privada de pedidos. Isso é intencional: o acesso direto é revogado e a execução
  ocorre pelo comando autorizado, com validação explícita de usuário e empresa.

## Limites da verificação

Não houve criação de carga real pelo navegador: a sessão disponível está
desautenticada. Não foram alteradas cargas ou notas operacionais para testes.

O typecheck global continua apontando erros preexistentes fora desta correção,
inclusive em `usePendingLoadsForRouting`, `useLoadItems`, `orderFormNormalization`
e `Loads` na base de produção. Nenhum erro foi apontado nos arquivos desta mudança.

Pedidos antigos que só tinham identidade do cabeçalho e não possuem registro
completo são recusados com `legacy_load_creation_requires_review`, evitando
presumir que sua composição é igual. Uma recuperação incerta é mantida até obter
uma resposta compatível; não se deve apagar o armazenamento para forçar reenvio.

O cliente deve atualizar a página com Ctrl+F5 antes de tentar novamente. Se aparecer
uma criação sem confirmação, deve usar **Recuperar criação**.
