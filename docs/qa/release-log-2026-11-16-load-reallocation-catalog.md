# Correção da listagem de Mover cargas

## Problema e causa

O usuário informou que a tela não carrega/não lista cargas. A consulta auxiliar de metadados em `LoadReallocation` usava `fiscal_documents(...)` sem especificar a FK. A tabela `load_items` tem tanto `load_items_fiscal_document_id_fkey` quanto `load_items_fiscal_tenant_fkey`; PostgREST rejeita o relacionamento ambíguo com HTTP 300/PGRST201. O estado de erro dessa consulta desabilita os seletores de origem e destino.

Evidência em produção (somente leitura, zero linhas solicitadas): projeção antiga retornou HTTP 300/PGRST201; com FK explícita o parser resolveu o vínculo e chegou à proteção de acesso (401/42501 para sessão anônima). Logs agregados das últimas 24h registraram duas respostas 300 para a projeção de realocação. Catálogo SQL confirmou as duas FKs. Não confundir resolução do parser anônimo com smoke autenticado.

## Alteração

- Base `9273fefab6a5cb3614d12f90df2180683c7c9aec`.
- Reutilizar `selectLoadItemFiscalDocument`, já empregado na consulta de itens, para selecionar a FK composta com tenant na consulta auxiliar da tela.
- Preservar seleção externa/nulável, paginação, filtros, tratamento de erro, permissões e comandos de movimentação/replanejamento. Sem SQL, migrations, Edge, Auth ou movimentação real de cargas.
- Teste de regressão React reproduziu erro antes da correção. Transporte simula a ambiguidade conhecida; não substitui PostgREST real.
- Novo E2E autenticado na base completa descartável verifica HTTP 200 da projeção real e ambos os seletores habilitados, em desktop/tablet/mobile e na repetição crítica. Somente leitura; não move notas de produção.

## Gates e publicação

Exigir validate, oito shards e database-and-e2e do mesmo candidato. Registrar resultados/SHA/alias no recibo final. Conferir a presença da projeção com FK no bundle público. Smoke autenticado produtivo depende de sessão; não usar credenciais reais como fixture.

Retorno: frontend anterior compatível com o mesmo banco, mas reintroduz a ambiguidade. Não excluir constraints nem desabilitar o isolamento para contornar o erro.

Orientação: atualizar ADM com Ctrl+F5 → Planejamento e cargas → Mover cargas → escolher origem/destino → selecionar notas → confirmar movimentação. Restrições de viagem iniciada, capacidade e replanejamento continuam válidas.
