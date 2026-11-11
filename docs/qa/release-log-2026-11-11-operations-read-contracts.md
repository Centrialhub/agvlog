# Log de release — consultas operacionais, 11/11/2026

## Contrato anterior e reprodução

Base bd0cb1f4af1d7ab39e224d01e805e19e04b80c91. Alvo AGVLog
qcvnsdrbcchaxvawcngk, ledger946/max20261110151444. Publicação por checkout
isolado em C: previamente autorizada pelo usuário; não usar coordenação F: ausente.

Painel: operations_dashboard_summary_v1(uuid) ausente no catálogo publicado.
Torre: chamada autenticada retorna HTTP200, mas contrato legado sem alert_limit,
alert_total/alerts_truncated e totais/limites por coleção da viagem. O parser
publicado rejeita a resposta, corretamente evitando indicadores incompletos.
Fontes e ACLs anteriores das duas funções afetadas preservadas em
operations-read-before-2026-11-11; não há dados de clientes nesses arquivos.

## Mudança e risco

Forward novo restaura resumo agregado já versionado, limitado a operador/admin
da empresa, com search_path vazio e ACL somente authenticated. SECURITY DEFINER
faz parte do contrato existente do resumo para agregados restritos; não é usado
para contornar o erro da torre. Retorno só expõe amostras operacionais limitadas.
Guarda de autorização falha fechada em NULL.

Torre mantém SECURITY INVOKER, auth/tenant/RLS, freshness, context_revision e
plano de rota. Patch estreito do reader com checks de contrato, limites50/50/25
e totais reais; snapshot com limite200/prioridade de alertas e identificação
de viagem. Não alterar writers, rastreamento SSX, políticas, dados ou Edge.
Migrações e manifestos congelados permanecem intactos.

## Validação e promoção

Teste nativo PGlite com funções reais: reproduzir resposta anterior rejeitada;
executar forward; parser atual aceita; limites e totais, repetição, acesso
cruzado, anon e operador revogado. Resumo com dados sintéticos realistas e
transação de mudança/rollback, sem operações reais. Fixture parcial não simula
Auth de rede/PostGIS, complementada por gate hospedado e smoke autenticado.
Exigir validate, oito shards e database-and-e2e no candidato antes da promoção.
Aplicar somente este forward revisado; não executar db push nem lote histórico.
Ordem banco/contratos, Git/Vercel e smoke das duas telas na sessão do usuário.

## Retorno

Restaurar exatamente as duas fontes anteriores e ACLs preservadas; remover a
função de resumo criada somente se não houver novo consumidor concorrente.
Nenhuma linha operacional é modificada. Retorno restaura o erro anterior da
interface, por isso preferir forward corretivo se ocorrer nova incompatibilidade.
Não promover o retorno automaticamente nem desfazer hotfix concorrente.

## Evidências

Horários UTC, SHAs, gate, versão do ledger e screenshots finais serão registrados
no PR. Advisors de saúde sem achados; segurança/performance têm achados anteriores
fora deste delta. Nenhuma emissão fiscal ou envio a motorista é teste autorizado.

O primeiro ensaio nativo exigiu corrigir apenas a sessão sintética, incluindo
active_tenant_id, sem alterar guards. Dois servidores ubuntu-latest (26.04)
falharam na resolução DNS dos mirrors Ubuntu durante a instalação do Playwright.
O job database-and-e2e fica fixado em ubuntu-24.04, já utilizado na homologação
documentada e suportado pelo Playwright. Sem alteração de testes, dependências,
alvos, credenciais, isolamento ou gates. Documentação consultada:
https://playwright.dev/docs/intro . Reexecutar o gate completo no SHA final.
