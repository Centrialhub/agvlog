# Ensaio local do bloco financeiro 141240–152557 — 2026-09-11

A cadeia financeira atual, com os originais fresh corrigidos de crédito, correção de baixa e lifecycle de folha, instala integralmente até 152557 em PGlite. O manifesto finance-forward-third-block-manifest-2026-09-11.json registra cada arquivo e SHA executado.

## Dependência encontrada e corrigida no ensaio

142740 exige load_payments.receivable_payment_id e bank_transaction_id. Essas colunas não pertencem ao baseline: sua origem real é 20260901141149_make_load_payment_recoverable.sql. A ausência foi reproduzida tanto no ensaio com baseline real quanto pelo coordenador no catálogo de produção. Nenhuma coluna ou associação foi inferida por valor/data. A fixture agora instala a migração operacional inteira e completa created_at de load_status_history, ausente na fixture estreita, usando seu campo real do baseline.

## Boundary de disponibilização

Artefato local: supabase/rollouts/finance_load_payment_internal_release.sql.
SHA256: ac953ef3bcc1594ae1c1175fe507abe4b598f3c1f5ce99a0d06d599246b588a9.
Original 141149 preservada: 555426ab41f13838648a680dd6a4eb57567d8f004c4ceb787cb37a3d3dd0c2f5.

O artefato contém o SQL original e uma boundary por hash exato do corpo (0609e96484f48a898608c89a7f127ad3), linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos e ACL. Exige require_access antes de entrar e novamente depois da espera advisory/membership lock, antes de devolver replay. A única RPC pública nova é apply_load_payment_command; os demais objetos criados são privados. A política canônica do coordenador determina o escopo ativo de empresa; o hold false continua negando chamadas. Não substitui helpers globais nem concede acesso a motorista/misto.

## Provas executadas

- financeLoadPaymentInternalRelease.test.ts: 3 PASS, 8,38s. Admin/operador alcança validação original com gate ativo; hold false, motorista, misto e tenant estrangeiro negados. ACL auth-only preservada. Falha tardia da boundary desfaz schema/colunas/RPC integralmente. Comando real de recebimento de carga + replay preserva um registro, com constraints flush.
- financeForwardThirdBlockIntegration.test.ts: 1 PASS, 3,38s. Instala os 12 arquivos integralmente; contagem inicial de caixa real e replay não criam dinheiro; saldo de subperíodo mantém abertura; load payment legado sem IDs permanece pendência e passa no parser real da UI. Pagamento legado é semeado ANTES dos guards financeiros, sem desabilitá-los; associação ao movimento registrado por comando e reversão preservam pagamento e único movimento, com constraints flush.
- Preflight somente SELECT: finance-load-payment-release-preflight-2026-09-11.sql.

## Limites

PGlite, não PostgreSQL nativo nem clone completo de Supabase. Auth/storage são fixtures, cron não instalado: worker usa seu ramo real de ausência de cron, sem job executado. A cadeia usa schema e funções operacionais reais selecionados, não todas as migrations operacionais/SSX. O teste não mede concorrência real nem comprova revisão por service worker após espera. Não emite documentos fiscais, não realiza transações bancárias e não escreve em produção. As provas de associação desta rodada cobrem pagável, não repetem toda a suíte de recebíveis. A autorização de empresa ativa remota é delegada ao can_access final do coordenador; os testes locais provam gate/tenant/perfis e não simulam workspace remoto.
