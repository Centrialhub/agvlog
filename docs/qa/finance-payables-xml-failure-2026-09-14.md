# Contas a pagar: falha de anexo XML — 2026-09-14

## Comportamento corrigido
Antes, erro do upload do XML era capturado e o insert/update da conta continuava, mostrando potencialmente erro e sucesso na mesma operação. Agora a rejeição do anexo interrompe antes da mutação. Formulário e File selecionado ficam preservados. A mensagem distingue leitura/preenchimento local do armazenamento do anexo. MALWARE_SCANNER indisponível recebe mensagem específica de serviço indisponível; não há alegação de anexo concluído.

Envio em andamento bloqueia novo envio e alteração/fechamento do modal. Mudança de contexto que desmonta workspace invalida a continuação antes da mutação. Nenhum backend, scanner, regra de segurança ou fluxo fiscal de emissão foi alterado. Esta correção impede falso sucesso; não resolve a dependência de scanner do caminho legado. A ponte Supabase-only permanece fora deste escopo.

## Reproduzir o preenchimento sem emissão
Componente real: src/components/financial/FiscalXmlUpload.tsx, input acessível Selecionar XML fiscal.
Parser real: src/lib/nfeXmlParser.ts, parseFiscalXml(File).
Fixture: src/test/helpers/payableNfeFixture.ts, reaproveitando XML sintético já usado em ingestionSafety.test.ts15-23.
Campos esperados: fornecedor EMITENTE TESTE; valor1234.56; documento123/1; vencimento2026-08-31; descriçãoPRODUTO TESTE. A leitura ocorre no DOMParser do navegador; não consulta nem emite documento fiscal.

## Testes
npx vitest run src/test/payablesXmlFailure.test.tsx src/test/payablesServerManagement.test.tsx --maxWorkers 1
5 testes PASS (2novos +3regressões), início16:49:44, saída0. Os2novos usam página, componenteXML e parser reais; somente transporte de upload rejeitado e mutações são controlados. Cobrem criação/edição, nenhum mutate após rejeição, preservação dos valores e reutilização do mesmo File na nova tentativa. Nenhum sucesso do servidor é fabricado.
ESLint dos4 arquivos: saída0, sem warnings. Typecheck/build não executados nesta subtarefa. Sem deploy/commit. Hashes na allowlist separada.
