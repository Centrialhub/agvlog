# Captura de emissões fiscais preexistentes — preparo local2026-09-11

Somente SELECTs agregados em produção. Nenhuma emissão, UPDATE fiscal, captura ou processamento remoto executado.

## Diagnóstico real

393 emissões;0 observações financeiras e0receivables reportados pelo coordenador. Trigger04550 captura apenas INSERT/UPDATE futuro, sem baseline.

85 emissões satisfazem predicado atual production+recorded+CTe/NFSe+status aceito:60CTeauthorized,10CTerejected,14NFSeauthorized,1NFSecancelled.308fora: legacy/uncertain, MDF-e ouerror, sem promoção automática. Entre74autorizadasrecorded, faltam protocolos em47CTe e14NFSe. Fontes eclientIDs diretos presentes; fretesCTepositivos. Logo no máximo13CTe podem virar títulos antes de outros checks; não anunciar74recebíveis válidos.

## Artefato preparado, NÃO aplicado

supabase/rollouts/20260911040114_finance_existing_fiscal_observation_capture.sql, criado viaCLI/movido para rollouts. SHA256 dbc10161ea76fcf40539f0335d0073bbc906af386efc88a10f4e7694d7b81172.

Reutiliza exatamente composição de snapshot04550, valida prosrcMD5da41aa6d3e38ff9449dc00a90a4d7346 antes de executar. SHARE NOWAIT emhub/CTe/fiscal/NFSe evita mistura comalterações concorrentes durantecaptura; locktimeout3s. Cronfinance-fiscal-projection-every-minute deve estarpausado. Apenas INSERTidempotenteobservations/jobs, unique tenant/emission/snapshothash echecagemcolisãopreservados. NenhumaRPC pública nova, mudança de status, chamada fiscal externa, UPDATE em fonte ou processamento da fila. Observed_at éagora e não datahistórica de autorização. Não reconstrói versões anteriores inexistentes.

## Prova local

financeExistingFiscalCapture.test.ts:1PASS/2,98s, ESLint0. Fixture usa fontes eprojeçãoSQL reais; seedhistórico ocorreu antes de instalar trigger, semdesativar guards.6fontes→4elegíveis, legacy/homologationexcluídas; repetirpreserva observações/jobs. Antesworker apenas título preexistente permanece. Processamentoreal emfixture cria umtítuloválido, ausência protocolo vai review, títuloCTepreexistente vai existing_receivable_requires_adoption; zerodinheirobancário, fontesbyteiguais. Nenhuma saída fiscal externa existe no teste.

## Pendências e critérios de continuação

- Capturar85 não resolve308fora deescopo. Listar essasfontes como históricoa revisar, não como valorzero nem documento nãofaturado semqualificação. Precisa prova deautorização/identidade real antes de adoção; não alterar dispatch_state para acionar trigger.
- Protocolosausentes devem ser obtidos/validados porfluxo fiscal legítimo; não afrouxar basisnem copiar identificadorqualquer para preencher.
- Dedupexistente process_fiscal_observation usa vínculosCTe/fiscaldiretos efinance_fiscal_receivable_origins por identidade/source. Não há prova genérica de associação de NFSe a título legado sem IDs. Com0receivablesatual não há colisão histórica observada; se surgir títuloNFSelegadosemvínculo antes deprocessar, classificar manualmente e não presumir que valor/cliente é prova. Não promover captura em adoção irrestrita.
- Worker permanece decisão separada após ler bases/pendências agregadas e garantir que títulos préexistentes continuam preservados. Dadoscomproblema aparecem nafila review. Não há emissão deCTe/NFSe emnenhum passo proposto.
- PGlite não éensaio de locksnativo nem baselineSupabaseintegral. CompartilhaosmesmoslimitesAuth/storage dasfixturesanteriores. Artefato preparadoaguarda revisão do coordenador, não autorizaçãoinferida de teste.
