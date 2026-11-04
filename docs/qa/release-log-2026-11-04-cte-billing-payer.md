# CT-e no faturamento por cliente

## Problema e comportamento

O catálogo espelhado do Hub copiava `fiscal_documents.client_id`, que identifica o destinatário da NF-e, para o cliente da cobrança do CT-e. Nos registros observados, o tomador era o remetente. Assim, a seleção pela JMacêdo não encontrava documentos, embora houvesse autorização e prova fiscal válidas.

A nova trigger resolve o cliente pelo CPF/CNPJ exato da parte indicada no `tomador` do snapshot persistido, dentro da mesma empresa, com cadastro ativo e correspondência única. Nomes não participam da identificação. Os papéis remetente, expedidor, recebedor, destinatário e terceiro são reconhecidos; papel/código conflitantes, cadastro ausente, inativo ou duplicado deixam o cliente sem associação, sem fallback para o destinatário. Catálogos legados sem snapshot Hub mantêm o contrato anterior.

A migração corrige somente CT-es autorizados em produção sem fatura ou recebível vinculado. Documentos fiscais, destinatários, valores, autorização, reservas, recebíveis, faturas e fronteiras de acesso não são reescritos. Qualquer cobrança existente, inclusive cancelada, impede a correção automática do vínculo. A seleção e o comando auditado continuam usando a mesma identidade do catálogo; CAS, prova fiscal e proteção contra cobrança duplicada permanecem intactos.

## Fonte e preflight

Base Git `2cbc00be39ed6209ef22b24819bd8341bb5223e2`. Checkout isolado em C:, conforme autorização do usuário. Projeto alvo exclusivo `qcvnsdrbcchaxvawcngk`. Foram observados 253 CT-es, 252 elegíveis, nenhum item de fatura ou recebível ligado ao CT-e; 216 snapshots com um CNPJ tomador e 37 com outro, todos com correspondência única de cadastro na mesma empresa. Um documento cancelado permanece fora do reparo. Nenhum documento fiscal foi transmitido em teste.

## Verificação e publicação

Testes nativos em PGlite executam preparação, confirmação sintética local, espelhamento, migração e comando real de fatura: reprodução antes da correção; duas filiais de mesmo nome; todos os papéis; isolamento entre empresas; ausência/duplicidade/inatividade; papel conflitante; proteção de cobrança existente; repetição idempotente; prévia obsoleta; ACL da trigger. A fixture acrescenta campos do catálogo/recebível presentes na produção; confirmação local não acessa provedores. O CI aplica a migração no PostgreSQL isolado e executa lint/pgTAP/E2E existentes, além de validate e oito shards.

Gate completo, SHA candidato, ledger, contagens após reparo e alias publicado serão registrados na descrição do PR após as verificações. Nenhuma Edge Function muda. Os 46 forwards e manifestos anteriores permanecem preservados; esta migração possui manifesto separado com hash.

## Retorno e limites

Retorno de código: remover somente a trigger e sua função privada; os vínculos corrigidos são compatíveis com o frontend e o comando anteriores. Não reatribuir automaticamente cobranças geradas após a correção. Se necessário desfazer vínculos ainda não cobrados, usar o checkpoint anterior por ID/empresa, sob lock, conferindo cliente atual e ausência de qualquer fatura/recebível; manter os já cobrados para revisão auditada. Nunca alterar o snapshot fiscal ou executar nova emissão como forma de retorno.

O usuário dispensou conferência autenticada na entrega anterior; nesta mudança, a prova final será a consulta do contrato publicado e os testes integrados. Não confundir contagem global com acesso de uma sessão específica.

## Orientação operacional

Atualize a página. Em **Faturas por Cliente → Nova Fatura**, selecione o nome e CNPJ do **tomador do frete**. Na etapa 2, abra **CT-e / CTRC**, marque os documentos, confira a prévia e conclua a fatura. As duas filiais são selecionadas separadamente. CT-es cancelados, de homologação ou já faturados não são oferecidos.
