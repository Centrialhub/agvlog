# Consumidor E2E do contrato de entrega — 19/10/2026

O full E2E nativo em edea62c391b6393bbe1b075d87a785afa742c0bf terminou com 107 aprovados, 21 skips já condicionados pela suíte e uma falha no ciclo operacional de motorista. A recusa foi correta: o teste não enviava fiscal_snapshot, obrigatório pelo contrato existente. A resposta era um conflito confirmado=false, não uma entrega incompleta nem perda das chaves legadas de sucesso.

O consumidor agora consulta get_driver_delivery_fiscal_snapshot_v1 pelo mesmo ator, empresa, viagem e parada, confere o escopo, a lista vazia de documentos da parada sintética e a revisão, e envia o snapshot real junto aos detalhes. Nenhuma API, permissão, migration, campo de cadastro ou regra financeira foi alterada. As assertions anteriores de entrega, replay, dados persistidos, despesa pendente, isolamento do cliente e chat permanecem intactas.

O ciclo completo corrigido passou nativamente em um clone diagnóstico exclusivo com PostgreSQL, Auth e Chromium reais, antes da integração: F:/AGVLOG/checks/delivery-snapshot-e2e-diagnostic.json (cópia de /results/delivery-snapshot-e2e-diagnostic.json do runtime próprio). O arquivo versionado não declara os gates completos do novo SHA. Estes exigem nova execução integral em fonte limpa e recibo final F:/AGVLOG/checks/sql-compatibility-final-gates-20261019.json.

Também foi esclarecida a causa da atribuição do mapa: o CSS anterior era removido na geração, pois as classes vêm do Leaflet em runtime; fora da camada utilities, o seletor permanece no bundle. Apenas comentário e explicação foram ajustados, mantendo o estilo já ensaiado com axe. Todos os reparos SQL e seus hashes permanecem iguais.

Os executores unitários do candidato anterior foram interrompidos para repetir os oito shards no SHA final; os resultados parciais não substituem esse gate. Nenhuma publicação ou alteração produtiva foi realizada.
