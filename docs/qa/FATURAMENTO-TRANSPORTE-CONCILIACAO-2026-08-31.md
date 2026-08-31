# Transporte fiscal e conciliação — 31/08/2026

## Evidência de produção

A operação 65f46dd4-57c4-4816-8f45-94c4e5b30fa0, NF 447165, CFOP 5352 em produção, foi criada às 15:25:17 UTC. O ledger registrou TRANSPORT_UNCERTAIN em aproximadamente 90 ms, sem identificador do Hub. As tentativas seguintes preservaram a mesma operação sem repetir o POST. O usuário informou ausência do documento no Hub.

O diagnóstico autenticado do AGV (pg_net 41023) retornou HTTP 200: baseConfigured=false, baseValid=false, credentialReadable=true, credentialHeaderValid=true. A URL da API estava ausente; a credencial recadastrada estava legível. O registro original contém apenas a exceção genérica, portanto não permite reconstruir sozinho a causa histórica.

O usuário forneceu https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1. Esse endpoint público passou a ser o padrão compartilhado pelo proxy e pelos pollers CT-e/NFS-e, preservando override explícito por HUB_FISCAL_BASE_URL. Nenhum segredo foi exportado ou rotacionado.

A consulta autenticada GET hub_documents_query, com idIntegracao=agvlog-65f46dd4-57c4-4816-8f45-94c4e5b30fa0, environment=production e type=cte, respondeu HTTP 200, success=true e documents vazio (pg_net 41036). Isso confirma a conectividade e a ausência nessa consulta; não constitui autorização fiscal.

## Correção e segurança

- Preflight valida URL HTTPS e cabeçalho antes de criar/retomar uma intenção. Erros locais de configuração ficam explícitos.
- cte-status-poll possui diagnose (sem chamada externa) e lookup (somente GET), após as mesmas verificações de usuário/tenant/papel ou cron autenticado e capacidade fiscal. Nenhuma dessas ações escreve no ledger ou emite documentos.
- Publicados e comparados byte a byte: proxy v76 (JWT obrigatório), CT-e poll v38 e NFS-e poll v41 (autenticação existente preservada).
- Migration 20260831153911_reconcile_unsent_fiscal_dispatch adiciona evidência de conciliação que somente o serviço pode gravar. A função claim continua SECURITY INVOKER e restrita ao service_role.
- Uma retomada exige prova explícita de configuração local ausente, confirmação do operador, consulta bem-sucedida vazia, hash do payload persistido e referência estável. Timeout ou ausência em consulta isoladamente não permitem retomada.
- A autorização é consumida sob os mesmos locks do claim. A identidade, reserva e payload são reutilizados integralmente. Uma nova incerteza não libera outra tentativa automaticamente.
- Foi registrada evidência apenas para a operação acima, com guardas de tenant, documento, NF, CFOP, ambiente, estado e respostas reais 41023/41036. Nenhuma operação foi apagada, nenhum status foi marcado autorizado e nenhuma segunda identidade foi criada.
- Verificação remota: hash corresponde; anon/authenticated não executam claim; authenticated não atualiza a evidência; service_role executa claim. Advisor sem apontamento sobre o ledger/claim alterados; demais 143 avisos e 3 informações do projeto permanecem fora deste escopo. Referência: https://supabase.com/docs/guides/database/database-linter.

## Validação

16 testes de transporte/autorização e 6 testes reais de banco PGlite para a conciliação passaram. A conciliação preserva payload/identidade, consome somente uma autorização, bloqueia payload alterado, falta de prova local e escrita do navegador.

Validação final: 2.724 testes em 230 arquivos passaram; TypeScript sem erros; lint dos arquivos alterados sem erros; 46/46 arquivos Edge aceitos; build Vite e verificações de bundle/ausência de segredos passaram. A primeira execução com cwd Windows leu fixtures CRLF, causando divergências de hashes; no checkout LF houve um timeout de 5 s em teste de despesas sem relação com a alteração. A execução final no checkout LF com quatro workers passou integralmente.

## Teste real e rejeição recebida

A retomada foi consumida às 15:44:34 UTC e o Hub criou o documento 8783b677-625d-41dd-bd25-cff720e0b444, número 269, série 1, com a mesma referência. Às 15:44:49 retornou CTE_EXCEPTION / EspdManCTeRejeicaoEnvioException: IE do destinatário não vinculada ao CNPJ. Portanto o envio real alcançou Hub e ManagerSaaS; não houve autorização fiscal.

O Hub retornou documento mesmo com HTTP de erro. O proxy agora preserva esse identificador quando referência, ambiente e CNPJ emitente correspondem ao pedido persistido; tentativas seguintes só consultam GET. Dois testes de banco verificam a retenção e a recusa de recibo alheio. O vínculo desta operação foi recuperado do recibo persistido com os mesmos guardas; não houve novo POST.

## Causa da IE misturada

O CNPJ da NF e do payload é 20560843000150. O client_id importado aponta ao estabelecimento 20560843000230. O cadastro do primeiro contém IE 1882510110074; o da filial contém 1882510110155, valor que foi enviado. Esses cadastros já existiam desde julho; não foram alterados nesta correção.

findRegistryClient priorizava client_id sobre CNPJ e resolveParty preservava o CNPJ explícito: essa combinação misturou os estabelecimentos. Com CNPJ informado, agora somente um cadastro com esse mesmo documento fornece IE/endereço; não há fallback por nome/ID incompatível. Sem CNPJ, a busca por ID/nome continua. Três testes reproduzem o caso real, o preenchimento da prévia e a falta de cadastro correspondente.

A operação enviada continua preservada sem nova autorização de retomada. Não substituir seu snapshot nem reenviar automaticamente. O erro genérico do Hub não fornece cStat numérico para encerramento automático da conciliação; falta confirmar o estado definitivo no provedor antes de corrigir/reemitir essa operação. O cadastro local corrigido pela seleção não substitui consulta oficial da situação estadual.

Consulta GET final (pg_net 41074): HTTP 200, success=true, exatamente um documento para a referência, id 8783b677-625d-41dd-bd25-cff720e0b444, status error, ambiente production. O AGV preserva hasProviderReference=true e não concede outro POST.
