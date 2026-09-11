# Compatibilidade estrita do guard operacional com workspace

Foram alterados somente os predicados de política em80608,85557,94049 e102652, ainda não aplicados no momento da correção. A policy existente no remoto é agvlog_active_tenant_context, restritiva,ALL, apenas authenticated, com USING e WITH CHECK private.is_request_tenant_member(tenant_id).

O guard continua rejeitando políticas de escrita; permite somente essa exceção exata. Mesmo mudar essa policy para SELECT a torna incompatível. Ausência da camada workspace permanece válida para a sequência fresh anterior; nenhuma policy nova é criada por este patch. Nenhum corpo de função foi alterado: substituição única conferiu o sufixo inteiro byte a byte, mantendo a cadeia de fingerprints de funções.

Validação: node --test scripts/test-finance-workspace-policy-guards.mjs →9passados. PGlite executa o predicado extraído dos quatro arquivos reais contra catálogo pg_policy real; testa ausência/exatidão, permissiva,USING,WITHCHECK,papel,comando eNULL. Nos cenários aceitos, uma policy permissiva extra deINSERT causa rejeição. A função de teste retorna false e serve apenas para construir a expressão de catálogo; não simula sucesso de acesso de negócio.

Hashes antes/depois estão em finance-operational-workspace-policy-guard-hashes-2026-09-10.json. Não houve DDL remoto nem PostgreSQL nativo. Essa prova é do guard específico, não execução integral das quatro migrations ou homologação da cadeia operacional.
