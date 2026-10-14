# PATCH2 SSX - cinco erros de negócio sem retry transacional

Taskpatch2-ssx-business-errors-20261012/CodexMerge, basee2b5dfb9. Correção LOCAL expressamente solicitada12/10; produção não alterada. PostgREST14.5 observado15:13:46UTC; dois forwards e trêsobjetos ausentes15:35:02UTC. Histórico aplicado927 e demaisfuncs intactos.

DeltaSQL apenas cinco literais40001→P0001, mensagens/RAISEapóswrites/rollback/earlyfalse/CAS/lease/batches/continuação/ACL/invoker/search_path/v1 preservados. Nenhumclassifierglobal oucaller modificado; somente dois hashesSSX no suplemento são atualizados. Original/followup e outrascincoentradas preservados. Versões07122904/07131504 não mudam; fontes/hashes anteriores continuamGit/handoffs. Se qualquerobjetoaparecer noalvo antesdo rollout, abortar e revisar forwardcompatível em vezde substituir história aplicada.

Caller diretoindex.ts336–399 não decideporSQLSTATE: commiterror→persistence_failed→failv2→finishv1quandoincerto→HTTP502; confirmação sócomcommittedtrue/ACKtrue. Abort10s não confirmaSQLcancelado. Pipeline385–404 registra errosem novaRPCcommit; RPCPOST noSDK não temretryautomático, mas isso não impede bugservidor. Outboxmotorista não chamaessasRPCs e ficaintocado. Minretry300/cooldown7200/token sucessor/replay/idempotência precisamdecontraprovas.

Novo fixture reusa schema/SQL/handler originais e acrescenta cincoRAISES reais/P0001/mensagens/rollback, initialCAS/expiryfalse, respostasperdidas/SQLapósabort comdedupe/backoff, realSDKPOST e ACL/v1. Provider/mockAuth ePGliteRAM não sãoNativeMVCC/PostgREST/Deno. Primeira propostaCincremental não registrada foi substituída pelo mínimo porqueosobjetos nãoexistem; falha42601 degeração preservada, semrelaxamento.

Não integrar/enqueue antesda revisãoindependente do diffselado/testes noSHA. Native continua dependente decustódia/isolation/novoescopo; semWSLstart/daemon/produção/SSXexterno/geocoderreal/contadeletions/ForgeBraces.
