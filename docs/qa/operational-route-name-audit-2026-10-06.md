# Auditoria da renomeacao de rota operacional — 6 de outubro de 2026

Task: operational-route-audit-20261006, owner CodexMerge. Base de revisao: 61adbbb997667396541244da147b224defb22e94, tree 328f33f69c352720574b24deebaa9d19bde7faaf. Esta entrega e um candidato local; a instalacao e a homologacao nativas continuam com o revisor exclusivo.

O UPDATE de useOperationalRoutes filtra tenant, ID e updated_at como compare-and-swap. O trigger legado chegou a executar, mas tentou inserir changed_by e changes em entity_audit_log, cujo contrato usa old_data, new_data e actor_user_id. O revisor observou42703 emc461 e confirmou a linha inteira inalterada. A fixture desta entrega reproduziu esse erro antes do forward e conferiu a escrita corrigida depois.

## Forward incremental

- Novo arquivo: supabase/migrations/20261006124418_restore_operational_route_name_audit.sql.
- Mantem a mesma funcao/OID, owner, ACL e binding bruto do trigger; move esse objeto para private e corrige somente corpo, SECURITY DEFINER e search_path vazio.
- Valida relacao, nome/timing/argumentos do trigger, identidade OLD/NEW, auth.uid(), vinculo interno ativo e contexto do tenant. Chama o writer fechado public._log_entity_audit; o log deriva usuario/papel no servidor e registra nomes anterior/novo.
- UPDATE continua sujeito a RLS e CAS. Nao acrescenta grants nem politicas; nao altera tabelas, dados, indice ou guard do nome.
- Preflight aceita somente predecessor/sucessor conhecidos. Recusa55000 contra corpo, namespace/destino, owner/ACL, helper/contexto, binding ou contrato do log desconhecidos.

O privilegio interno atende somente a auditoria: clientes continuam sem EXECUTE na funcao ou no writer e sem uma politica que autorize INSERT direto no log. Renomeacao de service_role sem ator passa a falhar fechada; UPDATE OF name sem mudar o valor continua permitido. Nenhum writer atual desse tipo foi encontrado no repo.

Nao aplicar a migration historica20260922021000 nesta entrega. Ela muda auditoria de sete campos/stamping e nao pertence aos26forwards revisados. Baseline, migrations anteriores e manifests13+13 ficam byte-identicos; o suplemento proprio registra o novo forward/rollback e seus hashes.

## Verificacao local concluida antes do commit

21 testes SQL passaram, alem de typecheck e lint focado. Executaram:

- predecessor42703 com reversao da linha inteira; forward e auditoria unica;
- identidade obtida no servidor apesar de updated_by fornecido pelo cliente;
- owner/admin, CAS obsoleto e revisoes sucessivas;
- nome igual, vazio e duplicado, preservando guard e unicidade;
- negativas de papel, inativo, anonimo, tenant/contexto incongruentes;
- INSERT direto e helpers fechados; falha no sink revertendo UPDATE e log juntos;
- catalogo/OID/ACL/binding e controles de dados preservados;
- forward repetido, rollback guardado, erro do predecessor restaurado e reaplicacao.

A fixture usa schema/indice/guard/trigger/writer/politicas versionados e oito helpers sanitizados de Auth/contexto capturados paraA6; registros e grants de tabelas sao sinteticos. A politica versionada de UPDATE permite admin/owner: operator continua sem escrita neste fixture. Isso nao certifica a politica efetiva do alvo nem decide ampliar acesso.

A primeira montagem falhou por faltar get_user_tenant_ids, dependencia real da politica de leitura. O helper real foi instalado e a fixture agora fecha o banco em erro. O log dessa montagem foi preservado; ele nao conta como reproducao do defeito. A suite completa corrigida passou.

Os checks finais no SHA commitado serao listados no handoff. Fixture PGlite de uma conexao nao comprova concorrencia MVCC entre sessoes, GoTrue, PostgREST, UI completa, advisors ou instalacao nativa. Nao houve conexao/aplicacao na replica nem uso dos seus servicos.

## Aceite nativo pendente

1. Capturar e conferir metadados/fingerprints reais de trigger, writer, contexto, log/defaults, owners, ACL, RLS e grants. O helper private.is_request_tenant_member fixa MD5capturado27bf2e71e1cf52212ac213a23de03dd7; hashes normalizados dos demais corpos constam no suplemento. Divergencia exige revisao antes da aplicacao, nunca mudanca cega da guarda.
2. Confirmar private fora dos schemas da DataAPI, sem CREATE cliente, preservando o USAGE necessario a outros helpers e sem novos grants nesta entrega.
3. Aplicar apenas o novo forward no ambiente isolado do revisor, preservar a fonte servida e reexecutar renomeacao autorizada em OperationalRoutes/Ingestion, recarga, CAS concorrente, negativas e auditoria. Conferir quais papeis sao escritores no contrato nativo; nao ampliar RLS para produzirPASS.
4. Executar lint incluindo public e private. Menos erros empublic por mover a funcao nao constitui aceite: sua execucao privada e efeitos precisam passar.

## Retorno compativel

docs/qa/operational-route-name-audit-rollback-2026-10-06.sql reconhece exclusivamente o sucessor esperado e restaura namespacepublic, corpo legado, invoker e search_pathpublic do mesmoOID. Preserva logs, ACL, RLS, binding, guard e indice. Rollback e reaplicacao foram ensaiados.

O rollback SQL restaura42703. Para voltar o frontend, manter o forward compativel e preferivel. Nao excluir dados/logs nem usar DROP CASCADE, reset ou replay historico.

## Preservacao e limites de entrega

Fonte61ad, PWA anterior, c461,32arquivos manuais,26forwards/manifests e A6 foram rechecados. Esta task nao altera frontend, frete, emissao fiscal, Auth/RLS, outras frentes, replica ou servicos. Nenhum enqueue/integrate/push/deploy/producao foi executado. Somente a arvore combinada futura pode receber aceite final.

Decisao do usuario12:58UTC: restauracaoQAsegura e branch/previewCI autorizados, dependentes de alvos/automações revisados pela coordenacao principal; emissao fiscal de teste expressamente fora do escopo. SSX sem comandos veiculares ou configuracao remota nesta etapa.

Documentacao consultada: [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html) e [trigger functions](https://www.postgresql.org/docs/17/plpgsql-trigger.html). Changelog publico lido em06/10; CLI2.116.0 criou o filename novo, sem upgrade.

## Closed candidate inventory follow-up

The exact-SHA baseline gate initially rejected the new forward as an unknown extra. Both original manifests and all26 forwards remain byte-identical. A separate baseline-supplement-manifest.json pins both normalized manifest hashes and the additional migration; validation requires exact identities, chronological order, LF bytes, SHA-256, and complete inventory. CI explicitly consumes all three validated layers. This does not execute SQL or approve the native baseline/release. The failed402826ec check is retained.
