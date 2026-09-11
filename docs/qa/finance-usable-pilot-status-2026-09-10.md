# Versão utilizável do financeiro — verificação em andamento

Pedido: priorizar a operação do conjunto já implementado antes de ampliar funcionalidades. Não declara implantação nem conclusão integral.

## Evidência atual

- Build de produção, orçamento de bundles e inspeção de artefato público passaram (sessão5593, saída0). Foi executado antes dos últimos ajustes de navegação; nova checagem final deve considerar estes ajustes.
- Consulta remota somente leitura confirmou ausência de get_finance_access, record_finance_movement, record_finance_expense_batch, list_finance_recorded_costs, list_finance_statements, get_finance_account_period_review, get_finance_period_money_package e repair_finance_unloading_projection. O banco existente não oferece o novo módulo.
- Não há ambiente de homologação separado, conforme resposta do usuário. Implantação sobre o banco do cliente exige primeiro um ensaio do upgrade; não aplicar baseline consolidada sobre histórico existente.
- FinanceUnavailableError diferencia endpoint ausente de negação de acesso e erro de rede. Quatro testes aprovados; nenhum fallback libera acesso.
- Navegação permanece montada enquanto o conteúdo financeiro aguarda autorização ou apresenta falha. Sete testes do agente aprovados, incluindo conteúdo protegido sem montagem e menu disponível.
- Painel ganhou atalhos para contas a pagar, folha e importação/conferência dos extratos existentes.
- Smoke E2E agora inclui cinco novas rotas financeiras. Novo finance-readiness.spec.ts exige headings reais e ausência de falhas de RPC/consulta. ESLint passou; E2E ainda não executado e não prova funcionamento no navegador.

## Critério operacional prioritário

Saída de R$500 ao motorista, gastos de R$480 classificados no mesmo envio, R$20 pendentes na prestação de contas, importação/verificação do OFX e conciliação única da saída. Complemento: gastos de R$530 com envio de R$500 geram obrigação de R$30 sem duplicar o dinheiro. Teste integrado delegado; ainda sem resultado neste registro.

## Trabalho novo estabilizado

Migrations vazias214012/214053 removidas pelos autores, nunca aplicadas. Não há writer de versões de descarga liberado. Contrato de leitura v2 está preparado no cliente com oito testes; backend atual seguev1. Essa preparação não satisfaz correção/cancelamento da origem.

## Próximos passos

Concluir teste integrado e checagem de tipos; resolver ambiente de ensaio; executar migrations completas e upgrade compatível, Auth/Storage e jornada no navegador; somente então classificar o conjunto como utilizável no ambiente escolhido. Depois continuar correções, relatórios e demais requisitos do plano integral.
## Validação final da navegação
TSC88496 terminou com saída0. Rodada conjunta do coordenador:24 testes aprovados em cinco arquivos (acesso, disponibilidade, navegação e demonstrativo). Build final37970 terminou com saída0; log em node_modules/.cache/finance-pilot-build-check.log, incluindo orçamento de bundles e inspeção do artefato público. O teste E2E permanece não executado. O ensaio integrado da saída continua em preparação; estes resultados não são autorização de liberação remota.

## Autorização posterior de produção
O usuário determinou aplicar diretamente em produção, dispensando a criação de homologação. A autorização está vigente: não pedir novamente. O avanço será feito sobre o catálogo real, sem baseline/reset e sem reescrever o histórico. Nova leitura confirmou429 migrations (outra frente aplicou23), portanto406 é apenas fotografia anterior. Primeiro bloco aditivo preparado em supabase/rollouts/20260910220257_finance_production_foundation_staged.sql, SHA5f0b9e2ad6b7da6d0a2a45eb2a2816f2a5f04651436f5e9c54aca52239051113: fundação financeira original, acesso fechado até completar dependências e ativação. Ainda não aplicado neste registro. O arquivo fica fora da cadeia fresh-install para evitar criação duplicada dos mesmos objetos.

## Aplicação real em produção
finance_production_foundation_staged aplicado com sucesso, versão remota20260910220623. Pós-verificação:finance_movements=0, finance_events=0, finance_commands=0;3tabelas com RLS;can_access(null)=false. Isso confirma fundação instalada com acesso ainda fechado, não módulo utilizável.
Tentativa subsequente de aplicar harden_dispatch_planned_route (fonte20260830062933) foi REJEITADA pela revisão automática antes da execução: altera planejamento operacional de rotas em produção, considerado fora da autorização financeira e com risco a despachos. Não reaplicar por outro caminho. Requer autorização explícita para essa dependência operacional. SQL guarda hashes/ACL atuais e preserva APIJSON→UUID; preflightreadonly aprovado, sem declaração de homologação integral. Nenhuma escrita dessa segunda migração foi confirmada.
