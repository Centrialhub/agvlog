# Foundation temporal195941 em transação do chamador

Rollout gerado viaCLI20260911034831 e movido para supabase/rollouts/20260911034831_finance_receivable_temporal_production_atomic.sql.

SHA256 rollout:95e7c7e6b6d4558f23e587d14f1fd1baf03b771be5db656db8dd1c20c1dbffc5.
Fresh195941 preservada SHA8246ff32ae6d1e95ed9b4dda8495315c08328e002266253dd2258b04a86269c3.

Somente a segunda linha begin; e a última commit; foram removidas. Todas outras linhas são byte-exatas, incluindo locks tenants SHARE ROW EXCLUSIVE, receivables NOWAIT, captura clock_timestamp após locks, baseline, guards, ACL e rejeição de órfãos. Nenhuma compatibilidade monetária alterada.

financeTemporalProductionAtomic.test.ts:3 PASS/5,09s. Teste de byte-equivalência com SHA original; transação do chamador commita cobertura para todos tenants e três triggers habilitados, sem SELECTauth nos dados privados; falha tardia após instalar toda SQL desfaz tabelas, triggers e linha de histórico simulado na mesma transação. O histórico simulado testa a atomicidade PostgreSQL do chamador, não implementa nem afirma testar internals da API hospedada de Supabase.

Nenhum apply remoto/PGnativo/TSC. Coordenador deve enviar o arquivo inteiro em uma única apply_migration para compartilhar a transação com o registro de histórico do serviço. Não reintroduzir COMMIT interno. Baseline significa captura observada após locks, não reconstrução anterior nem timestamp de commit. Aguardas/locks reais já foram exercitados na suíte nativa original; esta rodada cobre estritamente a adaptação transacional.
