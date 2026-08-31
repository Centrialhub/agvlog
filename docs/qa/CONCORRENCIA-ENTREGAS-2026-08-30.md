# Entregas — concorrência nativa e recuperação de rejeições

Estado: **correções locais verificadas; não publicadas neste lote**.

## Ambiente e limites

- PostgreSQL nativo 17.11, temporário, escutando somente em `127.0.0.1`, com senha aleatória e autenticação SCRAM. Nenhum serviço do Windows instalado.
- Fixture sintético compartilhado com `src/test/helpers/deliveryDatabase.ts`; não contém dados de produção. Aplica os arquivos reais das migrações de jornada, ocorrência, entrega e chegada.
- A fixture mínima não reproduz todas as políticas, triggers, extensões ou a API HTTP do Supabase. O banco hospedado consultado nesta etapa usa PostgreSQL 17.6.
- O teste de chegada executa o caminho de replay, autorização e bloqueios; **não executa o cálculo PostGIS**, cuja validação integral permanece pendente.
- O teste só considera concorrência comprovada quando `pg_blocking_pids()` identifica a sessão concorrente esperando pela sessão que mantém a transação aberta. Não usa apenas chamadas simultâneas ou atrasos para inferir sobreposição.
- Cada execução encerra o servidor no `finally`. Verificação independente dos processos confirmou nenhum PostgreSQL desse cache ainda ativo. Logs e clusters descartáveis ficaram em `node_modules/.cache/qa-postgres`, ignorado pelo Git; o arquivo temporário de senha foi removido.

## Reprodução e correção

1. **Vínculo canônico sem bloqueio próprio:** na fixture, remover `dispatch_trip_loads` passou pelo bloqueio de viagem/carga. O ensaio falhou por ausência de espera. A função `_lock_delivery_trip_graph` passou a bloquear explicitamente os vínculos, em ordem de carga/ID, antes das cargas. DELETE e UPDATE concorrentes agora esperam. Isso prova serialização no cenário coberto, não que qualquer remoção posterior ao commit seja proibida nem que todos os triggers de produção já foram ensaiados.
2. **Deadlock chegada × entrega:** o código de chegada adquiria parada → viagem, enquanto a entrega usava viagem → parada. Com a viagem bloqueada na primeira sessão, a chegada bloqueou a parada e esperou pela viagem; ao completar o grafo, a primeira sessão fechou o ciclo. PostgreSQL retornou `40P01: deadlock detected`. A chegada foi corrigida para descobrir o vínculo sem bloquear a parada, validar a posse, bloquear a viagem e então bloquear/revalidar parada e tenant. O mesmo cenário passou.
3. **Reenvio idêntico:** a segunda sessão esperou o commit e retornou `replayed=true`; ficaram exatamente um comprovante, uma ocorrência operacional e um evento canônico de entrega.
4. **Resultados conflitantes:** a segunda sessão esperou a entrega e recebeu rejeição de estado; não alterou resultado nem comprovante.

Resultado final: **5 testes nativos multissessão aprovados**.

## Recuperação na interface

- Rejeições transacionais conhecidas (`22023`, `23514`, `40001`, `40P01`, `42501`, `P0002`), sem tentativa anterior incerta, permitem limpar somente os uploads desse envio rejeitado e editar os campos preservados.
- Resposta perdida, exceção de transporte, código não classificado ou resposta de sucesso inválida preservam anexos, identificador e snapshot. Uma rejeição posterior não é usada como prova de que a tentativa anterior falhou.
- Falha na limpeza mantém a tentativa e seus caminhos; o próximo retry repete a limpeza antes de novos uploads.
- Após rejeição corrigível, as consultas interligadas são atualizadas. A nova tentativa usa o estado atual da parada; uma parada já encerrada/reatribuída bloqueia novo envio, mantendo o rascunho.
- A chegada agora aceita estados pré-chegada `pending`, `planned` e `arriving`, rejeita estado nulo e limita replay ao próprio ator/tenant/viagem.
- Testes: **31** do serviço de envio, **11** da tela renderizada, **68** PostgreSQL/PLpgSQL de entregas e **5** de contrato estático de chegada. Testes renderizados usam backend/componentes visuais simulados; não são E2E autenticado.

## Como repetir

Use Node 22 e uma distribuição confiável do PostgreSQL 17. O script não baixa binários automaticamente e não usa URL ou credencial de banco da aplicação:

```powershell
$env:PG_QA_BIN = 'C:\caminho\postgresql\bin'
npm run db:test:delivery-concurrency
npm run check
```

Nesta máquina foi usado o pacote portátil [PostgreSQL Windows da EDB](https://www.enterprisedb.com/download-postgresql-binaries), versão 17.11, extraindo somente `bin`, `lib` e `share` para o cache ignorado. SHA-256 registrado do ZIP: `6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3`. O hash foi registrado localmente; não substitui verificação independente de assinatura.

## Ainda necessário antes de publicar

- Corrigir/revisar a ordem de locks de `transition_load_status_v1`, `_assert_load_transit_graph`, `driver_register_departure`, `transition_stop_status_v1` e escritores de alocação.
- Ensaiar o conjunto com mirrors, RLS, constraints e PostGIS reais; os cinco cenários não demonstram ausência universal de deadlocks.
- Separar APIs aditivas do corte de compatibilidade legado e ensaiar recuperação completa das funções/índices substituídos.
- Persistência da fila de envio após fechar/recarregar a página, anexos e respostas da operação, upload/scanner real e E2E autenticado continuam pendentes.

Nenhuma mudança em produção, emissão fiscal, contratação adicional ou ativação SSX ocorreu neste lote.
