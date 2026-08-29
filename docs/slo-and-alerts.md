# SLOs e alertas iniciais

Janela padrão: 30 dias, com burn-rate curto de 1 h e longo de 6 h. SSX e fiscal
não entram no SLA funcional enquanto desativados; tentativas bloqueadas pela
flag são comportamento correto, não indisponibilidade.

| Sinal | SLO inicial | Alerta P1 | Evidência |
|---|---:|---:|---|
| Frontend/API disponível | 99,9% | burn-rate 14,4×/1 h ou 6×/6 h | probe externo |
| Login/convite bem-sucedido | 99,5% | erro >2% por 10 min | Auth + probe sintético |
| RPCs/telas críticas p95 | ≤1,5 s backend; LCP ≤2,5 s | p95 >2,5 s por 15 min | métricas por release |
| Edge Functions do núcleo | ≥99,5% sucesso técnico e de negócio | erro >2% por 10 min | logs estruturados |
| Upload/POD | ≥99,0% | 3 falhas em 10 min | storage + eventos |
| Exceção frontend | <0,5% das sessões | duplicação >3× em 10 min | `application_error_events` |
| Cron/fila | 100% dentro de 2 períodos | atraso >2 períodos | estado de negócio, não só HTTP |

Todo alerta deve conter ambiente, release, janela, severidade, correlation ID
quando existir e link para `production-runbook.md`. São proibidos email, CPF,
token, cookie, documento e payload completo.

Teste sintético mínimo antes de go-live:

1. autenticar operador fixture;
2. gerar um erro controlado com correlation ID conhecido;
3. comprovar recepção e alerta;
4. seguir o runbook até a identificação do release;
5. apagar/expirar o evento conforme retenção de 30 dias.

O teste só é aprovado com captura do alerta e timestamps de detecção/triagem.
