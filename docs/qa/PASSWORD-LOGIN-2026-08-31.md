# Login sem código autenticador — 31/08/2026

## Decisão e alcance

O usuário solicitou a retirada definitiva do código no login e confirmou
explicitamente a extensão às operações administrativas e financeiras após
ser informado do risco de comprometimento de senha.

O frontend não carrega mais a tela, hook ou fluxo de cadastro/desafio MFA.
A configuração versionada desabilita cadastro e verificação TOTP.
A migração `20260831164442_remove_authenticator_requirement.sql` substitui
17 funções para retirar somente a exigência de segundo fator. Também elimina
o helper de MFA que deixou de ter consumidores e verifica o catálogo para
recusar uma remoção incompleta.

Permanecem autenticação por senha, cadastro por convite, limites de sessão,
rate limiting, vínculo ativo, perfil, isolamento de empresa, RLS, grants,
regras financeiras, idempotência, varredura de uploads e auditoria.
Nenhum usuário, fator TOTP, sessão, arquivo ou dado financeiro foi apagado.

## Validação local

- 65 testes direcionados aprovados: login por senha com o SDK instalado e rotas
  reais, fatores existentes verificados/incompletos, logout, recarga da sessão,
  dados financeiros, despesas, ajustes, chat, uploads e Torre de Controle.
- 19 testes de configuração e 18 cenários adicionais de erro/recuperação financeira
  aprovados (102 testes direcionados no total). Mensagens de servidores antigos
  orientam atualizar a política de acesso, sem pedir um autenticador inexistente.
- As funções alteradas são executadas em fixtures PGlite com o SQL real;
  o teste compara grants, SECURITY DEFINER/INVOKER, search_path e volatilidade
  antes/depois e executa a verificação final de ausência de exigência AAL2.
- Controles negativos incluem acesso anônimo, senha inválida, ator forjado,
  outra empresa, perfil indevido, metadados editáveis e vínculo revogado.
- Typecheck, lint dos arquivos alterados, build e verificações do artefato público
  aprovados; sintaxe das 46 Edge Functions aprovada.
- Suíte geral: 2.731 testes aprovados e nove falhas preexistentes em cinco arquivos:
  driverDeliveryRollout (2), driverJourneyDatabase (1), driverDepartureDatabase (1),
  expenseMfaReleaseDatabase (4) e driverOccurrenceBackendContract (1).
  Todas foram reproduzidas exportando HEAD para uma cópia isolada, sem esta
  alteração (126 casos aprovados nos arquivos reexecutados).

## Publicação pendente

A conexão Supabase recusou leitura do banco e execução dos advisors com
`You do not have permission to perform this action`. Nenhuma alteração foi
aplicada ao projeto hospedado e nenhum deploy foi realizado.

Após restabelecer acesso ao projeto `qcvnsdrbcchaxvawcngk`:

1. Validar o estado do destino e aplicar a migração em staging; repetir advisors.
2. Publicar em conjunto a migração, o frontend e as Edge Functions
   `secure-upload`, `calculate-trip-route` e `update-trip-live-status`.
3. Sincronizar as opções TOTP do Auth hospedado; não excluir fatores ou sessões.
4. Repetir login real por senha para owner/admin com fator existente e os
   controles negativos de empresa/perfil, além do smoke operacional.

Os testes de autenticação usam transporte sintético com o SDK real; não
substituem um ensaio no serviço Auth hospedado. A migração completa ainda
precisa ser aplicada ao destino antes de declarar a alteração ativa em produção.
