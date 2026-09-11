# Fundação temporal de recebíveis — PostgreSQL nativo

2026-09-10: **8 testes passaram em PostgreSQL 17.11**. Execução final: sessão 30488, saída 0; servidor descartável encerrado. Nenhum banco remoto acessado e nenhum SQL de produto alterado pelo executor.

Migration `20260910195941_finance_receivable_temporal_foundation.sql`: SHA256 **8246ff32ae6d1e95ed9b4dda8495315c08328e002266253dd2258b04a86269c3**, conferido antes da instalação. Hashes das dependências financeiras são registrados no log.

## Reprodução

- `PG_QA_SUITE=finance-receivable-temporal node --experimental-strip-types scripts/test-delivery-concurrency.mjs`
- Casos: `scripts/test-finance-receivable-temporal-native-cases.mjs`.
- Log: `node_modules/.cache/qa-postgres/finance-receivable-temporal-native-2026-09-10.log`.

## Casos comprovados

1. Writer segura tenants e modifica recebível; migration espera comprovadamente por pg_blocking_pids. Após liberação, baseline contém o título final e coverage_starts_at é posterior ao clock_timestamp registrado pelo writer imediatamente antes do commit.
2. Migration segura suas travas enquanto outra sessão tenta criar tenant e título. Após commit, novo tenant tem cobertura new_tenant e título tem evento INSERT.
3. Writer já possui trava de escrita em receivables; segunda trava NOWAIT da migration retorna 55P03, sem 40P01. Writer consegue commit e nenhuma tabela de versões parcial permanece.
4. Título com tenant órfão na fixture provoca rejeição da instalação inteira: nenhuma tabela de versões ou trigger de captura residual.
5. Trigger AFTER de bootstrap com nome ordenado antes dos triggers financeiros cria título do tenant novo: cobertura BEFORE já existe e captura funciona. Repetição de INSERT ON CONFLICT do tenant preserva integralmente a cobertura original.
6. UPDATE seguido de rollback não deixa versão. Writer sem auth.uid registra ator system/null; DELETE gera tombstone com OLD e NEW null.
7. JSON temporal sem identidade é rejeitado por CHECK. Leitura/escrita privada como authenticated é negada. Troca de tenant é rejeitada pelo guard financeiro preexistente; histórico não pode ser apagado e TRUNCATE CASCADE da origem é bloqueado pelo guard temporal.
8. Comando real apply_receivable_financial_command registra recebimento parcial de 25,00 e recálculo na mesma transação de captura; devolução real reverte received_amount para zero e captura o estado. Execução do recebimento seguida de rollback não deixa pagamento nem versão temporal.

## Limites e interpretação

A captura é relógio de execução dentro da transação, **não relógio de commit ou visibilidade histórica**. event_order é alocação de sequência, com possíveis lacunas; não demonstra ordem de commits. Não há API de posição histórica nesta entrega e a baseline não reconstrói eventos anteriores à instalação.

O ensaio usa tabelas da baseline e funções/migrations reais do grafo financeiro de recebimentos, projeções, correções e devoluções. Há adaptação explícita de autorização à fixture financeira local; a função de ação de fechamento não exercitada rejeita sempre. Algumas relações externas e a plataforma completa não estão instaladas. Não é ensaio integral de upgrade ou autenticação remota.

Os casos de autoria system, bootstrap, dados órfãos e corrupção JSON são inserts/updates owner locais deliberados; não indicam grant público. O sucesso financeiro usa RPC real. Worker fiscal e descarga real foram cobertos pelo autor em PGlite, não repetidos nesta suíte nativa.

Compatibilidade futura: cobertura BEFORE INSERT pressupõe que não surja outro BEFORE posterior que suprima INSERT retornando NULL, nem caminho de conflito por chave alternativa que desvie a criação para outro ID. O catálogo atual examinado possui PK id e bootstrap AFTER; caso esse contrato mude, é necessário verificar que não restou cobertura de tenant não criado. Não há constraint diferida para essa hipótese nesta versão; decisão de escopo registrada com o coordenador.

As tentativas anteriores pararam por ajustes do harness: criação inicial de roles, delimitador do trigger adversarial, mensagem de identidade rejeitada por guard anterior e TRUNCATE sem CASCADE interceptado primeiro por FK. Todas encerraram seus clusters. A execução final repetiu os oito casos no hash final e terminou com `Disposable PostgreSQL stopped.`.
