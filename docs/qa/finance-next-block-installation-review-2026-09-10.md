# Próximo bloco após233625 — instalação inativa, revisão somente leitura

Ordem local/manifesto:234654,235237,235705,000731,002244,003529,004550,005509,010034,011121,012152,012756. Hashes SHA256 integrais em JSON vizinho, calculados dos bytes atuais. Nenhum SQL aplicado e nenhuma execução PostgreSQL nesta frente. O coordenador permanece único escritor.

## Não são todos aditivos inertes

| Arquivo | Efeito e pré-condição |
|---|---|
|234654 boundary driver|Policies restritivas em tabelas legadas financeiras; revoga driver_create_expense; not_driver inclui membershipdriver e vínculo drivers ativo. Nega motoristas/mistos imediatamente, independente do gate. Precisa inventário tabelas e ausência de policy homônima.|
|235237 boundary RPC|Envolve dezenas de corpos PLpgSQL com require_access. Gatefalse bloqueia todos esses writers/readers legados imediatamente. MantémOID/defaults/ACL, mas muda corpo/hash. Adiar até terminar cadeia operacional, incluindo30183929 recebimentos e30192908 ciclo faturas e demais predeps inventariados pelo coordenador; não aplicar antes de resolver140248. Guard aceita só adapters SQL explicitamente conhecidos e assinaturas esperadas.|
|235705 recibos|Policies restritivas de storage por pastasfinanceiras; fecha upload/update/delete direto e leitura sem capacidade. Com gatefalse impede comprovantes financeiros antigos. Provas operacionais fora dessas pastas mantêm policies próprias.|
|000731 folha|Leitores novos e patch literal de close_payroll_period(uuid,text). O fechamento passa a depender da projeção protegida por can_access; gatefalse interfere no comando existente. Guard finance_payroll_close_contract_changed não pode ser relaxado.|
|002244 pagáveis|Tabela links+RLS/SELECT, comandos novos, capacity partagé e patch expense_options. **Trigger BEFORE INSERT payables_payments exige can_access para TODO pagamento legado**, não só novos links; instalar inativo bloqueia pagamentos antigos. Outros triggers preservam pagamentos vinculados.|
|003529 reversões|Depende002244; tabela append-only+RLS, troca cálculo capacidade/patches e leitura auditoria. Reversão só disponível através comando protegido. Conferir assinaturas/corpos exigidos.|
|004550 captura fiscal|Observations/jobs com RLS e SELECT; trigger AFTER INSERT/UPDATE hub_fiscal_emissions captura snapshots e enfileira. **Trigger roda com gatefalse** e pode impactar transações fiscais em caso de coluna/dependência incompatível. Não faz backfill automático observado no arquivo.|
|005509 base fiscal|Helpers/leitor sobre observations e snapshots; depende004550 e schemasCTe/NFSe/clients. Predominantemente aditivo, mas não resolve ausência do predecessor capturador.|
|010034 projeção fiscal|Origens/eventos, processador insere/altera recebível; manual exige acesso. Guard de inserção em receivables_payments altera legado. Depende basesfiscais e contrato título/recebimento operacional já final.|
|011121 créditos|Tabela append-only, patches em _recalc_receivable_received/_guard_receivable_ledger/_receivable_financial_snapshot; depende30183929 e010034. Referencia client_invoices/closing_reports. Recibos liberados viram créditos, não apagados; SQL de instalação não executa regularização por si.|
|012152 contexto fiscal|Patch snapshot e _lock_receivable_financial_graph, exige literal declarev_invoice e contrato returnrevision. Ordemlockfiscal antesgraph; não aplicar antes da implementação operacional definitiva.|
|012756 worker|Enriquecejob, novo worker/lister e cron. Worker exige auth.uidNULL, **não testa can_access**. Logo gatefalse não é barreira para scheduler owner.|

## ACL e execução automática

Tabelas novas revogam DML de public/anon/authenticated/service e concedem SELECT definido no arquivo; authenticated via policies can_access. RPCs públicas invoker chamam helpers privados com ACL explícita. run_fiscal_queue tem EXECUTE revogado de public/anon/authenticated/service; ownercron continua capaz de executar. Não confundir ACLservice negada com paralisação do cron.

Worker012756: advisorylockfinance:fiscal-queue-worker; lotepadrão50/máximo100; ordem available_at/observed_order; janela20s; locks fiscal/tenantfinance; skiplocked; erro transforma tentativas em backoff e apósrepetição revisão. Atualiza recebíveis via processador mesmo sem UI publicada.

## Plano de scheduler staged — sem apply

Para preservar o SQL original e impedir primeira execução automática:

1. Antes da unidade transacional, conferir extensão/catalogo cron e API cron.alter_job, inexistência do job finance-fiscal-projection-every-minute ou provar que já está pausado e sem execução em andamento. Se houver worker ativo anterior, pausar ao final não desfaz execução já iniciada: resolver explicitamente antes.
2. Executar corpo original012756 integral, inclusive cron.schedule, numa única transação controlada pelo aplicador. Não remover nem editar schedule original para fingir equivalência de hash.
3. **Antes do mesmoCOMMIT**, localizar jobid por nome+database+owner, exigir exatamenteum e chamar cron.alter_job(jobid,active:=false). Guardar definição de schedule/command preservada na auditoria de implantação.
4. Postcondition ainda na transação: activefalse; schedule * * * * *; command exato SETstatement_timeout25s+run_fiscal_queue50; ACLworker semanon/auth/service; can_access continua false. Qualquer falha aborta tudo, evitando janela de commit com job ativo.
5. Se pg_cron ausente, arquivooriginal só emiteNOTICE e não criajob. Registrar explicitamente worker ausente; bootstrap posterior também deve ser instalado+pausado atomicamente até liberação. Não chamar bootstrap automaticamente, pois ele agenda ativo.
6. Depois do commit, SELECT catalogojob/run_details para provar estado, sem dispararworker como teste. Ativação só no checkpoint do coordenador depois da cadeia completa/validação.

Mesmo padrão será necessário para022059finance-bank-reconciliation-every-minute quando esse bloco chegar. Evitar agrupar dois jobs existentes sem investigar oestado prévio. Proposta não dispensa pré-condições do mecanismo remoto nem substitui teste real da transação do coordenador.

## Recomendação para o checkpoint atual

Com140248/cadeiaoperacional ainda em resolução, não aplicar235237 nem tratar000731/002244 como aditivos livres. Não há próximo bloco inteiro sem interferência: melhor segurar esses patches e pré-validar corpos/colunas emensaiodescartável. Separar tabelas de suas migrations originais exigiria variante staged explícita com manifesto/guards e reconciliação de origem, propriedade do coordenador; não criar fragmentos ad-hoc nem marcar migrationintegral como aplicada só porDDLparcial.
