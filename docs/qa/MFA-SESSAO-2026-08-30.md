# MFA vinculado à sessão — implementação e verificação

Estado: **corrida de sessão corrigida e testada localmente; não publicado**. O gate completo da coordenação de sessão passou com 2.453 testes/206 arquivos. Validação em navegador real e publicação coordenada continuam pendentes; objetivo integral em andamento.

## Correções

- O resultado do MFA pertence ao token atual. Troca de ator, tenant ou papel remonta o gate; troca de token bloqueia imediatamente o conteúdo até nova validação.
- A consulta usa o JWT explícito no SDK instalado e valida o usuário no Auth. Uma resposta de `verify` isolada não libera o conteúdo: o novo estado da sessão precisa ser observado e validado.
- Prazo de oito segundos e cancelamento lógico impedem respostas antigas de atualizar a tela ou iniciar etapas seguintes. Uma requisição Auth já enviada não pode ser desfeita pelo cancelamento local.
- Expiração é conferida em cada fronteira assíncrona, inclusive quando uma aba em segundo plano atrasa o temporizador. O temporizador também oculta conteúdo que já estava liberado.
- Criação do autenticador ocorre somente por ação explícita, com nome estável `AGVLog`. Leituras, recargas e StrictMode não criam fatores. Uma resposta de cadastro perdida exige consultar o estado atual, sem criar automaticamente outro fator.
- QR/chave ficam apenas na memória do componente, não em cache ou armazenamento persistente. Código exige seis dígitos e é limpo na submissão/troca de fator. Chaves React distintas impedem duplicação dos controles.
- Descarte exige confirmação e nova consulta de propriedade/estado; somente configuração AGVLog ainda não verificada pode ser removida. Fatores verificados e fatores de outros aplicativos são preservados.
- Perda de MFA oculta os filhos, remove consultas privadas e cache de mutações e cancela confirmações globais ainda não submetidas. Isso não desfaz comandos já enviados nem apaga filas duráveis.

As skills Supabase e React orientaram a validação de sessão pelo servidor, a separação entre consultas e ações de cadastro e o tratamento de estado/segredos sem persistência adicional. Não houve instalação de pacote ou ativação de SMS.

## Evidências locais

1. Ampliação inicial: **25 aprovados e duas falhas reproduzidas** — continuação de verificação após expiração com temporizador atrasado e duplicação de controles por chaves React iguais. As duas foram corrigidas; não se alteraram as asserções para aceitar os defeitos.
2. `PrivilegedMfaGate.test.tsx`: **28 aprovados**, incluindo owner/admin, AAL1/AAL2, troca de token/conta, respostas tardias, expiração, ausência de contexto, timeout, StrictMode, cadastro explícito, resposta perdida, seleção e descarte de fatores.
3. `mfaSessionFrontendDatabase.test.tsx`: **8 aprovados**. Usa AuthProvider, TenantProvider, gate, página de acertos e SDK Supabase/Auth/PostgREST reais. HTTP é interceptado por um gateway sintético fechado; leitores e permissões executam o SQL real do repositório como `authenticated` em transações revertidas no PGlite.
4. Esses oito cenários cobrem descoberta de owner AAL1 sem acesso financeiro, promoção pelo evento real `MFA_CHALLENGE_VERIFIED`, rebaixamento da mesma conta, operador/motorista, revogação de vínculo, código inválido com recuperação, cadastro/verificação e recusa de validação de usuário pelo Auth.
5. O primeiro ensaio integrado teve sete aprovações e uma falha no simulador: faltava o cabeçalho de versão que permite ao SDK interpretar `code`. O gateway foi alinhado ao contrato do SDK; o teste de erro permaneceu exigindo a mensagem de código inválido e acesso negado.
6. Regressão focal de sessão/tenant/acertos/MFA: **74 aprovados em cinco arquivos** antes da inclusão do caso admin. Depois, MFA e configuração: **47 aprovados em dois arquivos**. Tipos e lint dos arquivos alterados passaram.

Gate amplo `npm run check` concluído com código zero: **2.435 testes em 205 arquivos**, tipos, lint, qualidade (107/113 avisos `any`, sem novo arquivo acima de 500 linhas), sintaxe de 41 Edge Functions, build e scanner de artefatos públicos aprovados. Build em 20,57 s; maior chunk 488,3 KiB; entrada principal 370,1 KiB. A cobertura configurada de cinco arquivos é 93,03% de linhas/declarações, 65,83% de ramificações e 81,81% de funções; não é cobertura de toda a aplicação.

Regressão PostgreSQL **17.11**: **290 cenários nativos aprovados**, código zero e cluster descartável parado. Sem novos cenários nativos neste bloco; os oito testes de integração novos executam SQL no PGlite. Os hashes SHA-256 de **15 arquivos** capturados antes/depois do gate permaneceram idênticos. Não houve edição de código ou testes durante a execução e não houve segundo processo de cobertura escrevendo no mesmo diretório.

## Achado reproduzido: resposta MFA antiga substituía a sessão global

Após iniciar o gate, um ensaio independente em memória com o SDK instalado, sem editar arquivos nem usar rede externa, executou esta sequência:

1. Sessão sintética da conta A em AAL1; envio de `mfa.verify`, com resposta retida.
2. `setSession` instala a conta B; `getSession` confirma B.
3. A resposta de verificação de A é liberada; o SDK emite `MFA_CHALLENGE_VERIFIED` para A e `getSession` volta a retornar A.

O processo terminou com código zero e registrou exatamente `before_late_verification=account-B` e `after_late_verification=account-A`. O código instalado de `_verify` salva a sessão antes de notificar os consumidores. O cliente da aplicação não configura um lock personalizado; a configuração padrão do SDK usa a coordenação sem lock. Não foi realizado esse ensaio com contas reais.

**Consequência:** o checkpoint do hook impede atualizações antigas do seu próprio estado, mas não impede a alteração da sessão global já feita pelo SDK. O AuthProvider ainda aceita esse evento. A suíte ampla aprovada não cobria essa sequência; portanto, seus resultados não provam isolamento completo de sessão nem autorizam a publicação de MFA.

Esse era o estado anterior à correção de coordenação descrita a seguir. O ensaio foi preservado como evidência da causa, não como descrição da implementação atual.

## Correção da coordenação de sessão — checkpoint posterior

- A fábrica real do cliente usa o contrato público de lock do SDK com Web Locks exclusivo. Um timeout de aquisição cancela somente quem espera; nunca toma o bloqueio de uma operação ainda em andamento. O lock padrão oferecido pelo SDK não foi reutilizado, pois seu caminho de timeout pode tomar um lock ocupado.
- O login por senha participa explicitamente da mesma fila: na versão instalada, esse método não passa pelo lock interno do SDK. Leituras `getUser(jwt)` também são coordenadas e recusam JWT diferente do token atualmente persistido antes de chamar Auth; uma resposta antiga não pode apagar outra sessão.
- Requisições ao caminho Auth do mesmo projeto têm prazo de cinco segundos, incluindo consumo do corpo. Mesmo que o transporte ignore o abort, a resposta tardia não volta ao SDK. Isso não cancela um efeito que o servidor já executou: resposta incerta requer consultar/recuperar o estado atual.
- RPCs, uploads e chamadas fiscais mantêm seus transportes. Não foram instalados pacotes, alteradas versões ou adicionadas credenciais.
- Sem Web Locks, leituras e logout mantêm fila local; novas verificações MFA em AAL1 são bloqueadas com orientação para navegador atualizado em conexão segura. Esse fallback não é anunciado como proteção entre abas.
- `mfaSessionFrontendDatabase.test.tsx` passou de oito para **17 cenários**: resposta retida com troca de conta, login por senha de outro cliente, logout, nova sessão AAL1 da mesma conta, leitura com JWT antigo, ausência de Web Locks, timeout, recriação a partir do armazenamento e recuperação antes de resposta antiga chegar. Tela, SDK, armazenamento e permissões SQL são conferidos.
- `authCoordination.test.ts` acrescenta **nove casos** de fila, timeout, exclusão, transporte e cancelamento. Regressão dirigida final: **93 aprovados em cinco arquivos**.

Gate completo posterior encerrado com código zero: **2.453 testes em 206 arquivos**, TypeScript, lint, qualidade (107/113 avisos `any`), 41 sintaxes Edge, build e scanner aprovados. Testes em 362,93 s; build em 20,68 s; maior chunk 488,3 KiB; entrada principal 373,5 KiB. Os **18 hashes** capturados antes/depois permaneceram idênticos. Nenhum código/teste foi editado durante o gate e não houve outro processo de cobertura no mesmo diretório. A cobertura continua limitada aos cinco arquivos configurados, não à aplicação inteira.

Os **290 cenários PostgreSQL 17.11** descritos acima pertencem à execução anterior; não foram repetidos neste checkpoint, que não mudou SQL. Os testes novos executam o SQL real local com SDK real e HTTP Auth sintético. Web Locks é simulado deterministamente: dois clientes compartilham armazenamento e o canal real do SDK, mas isso **não é ensaio em duas abas de navegador real**. O corpo de `verify`/TOTP do GoTrue hospedado não é reproduzido.

## Conferência somente leitura de produção

Projeto `qcvnsdrbcchaxvawcngk`. Foram consultados somente assinatura, configuração, privilégios e hashes dos corpos de oito nomes de função, sem ler registros operacionais ou financeiros. Sete funções foram encontradas; `session_has_privileged_mfa_v1(uuid)` não estava instalada.

Os corpos de `get_current_memberships_v1`, `list_driver_settlements` e `list_driver_settlement_filter_options` coincidem com os usados pela fixture. Entretanto, os três helpers abaixo ainda coincidem exatamente com `20260828160000_remove_privileged_mfa.sql`, não com a candidata de restauração:

| Helper | MD5 do corpo em produção |
| --- | --- |
| `is_tenant_member(uuid)` | `9dc8218defa0226b77bcb3d8b6718fcb` |
| `is_tenant_admin(uuid)` | `495068d5fd73ba2559f4a676d1f193b0` |
| `is_tenant_operator_or_admin(uuid)` | `12a3da73dd45088c8adb6cc208c8b88c` |

Esses três corpos não mencionam AAL2 nem `auth.jwt`. `is_user_internal_role` também difere da candidata. Todas as sete funções verificadas negam EXECUTE a `anon`. Os três leitores não constituem prova da aplicação do MFA, pois dependem da versão dos helpers. **Não publicar apenas a interface e declarar MFA de backend concluído.**

O script de comparação da migração antiga confirmou os três hashes acima e encerrou com erro ao procurar `is_user_internal_role`, que não é definida naquele arquivo; não houve extrapolação dessa comparação para uma quarta função.

## Limites e próximos passos

- Não é E2E autenticado contra GoTrue/PostgREST hospedados. JWTs, usuários e fatores do gateway são sintéticos; a validação criptográfica/TOTP do servidor não é reproduzida.
- Nenhum fator real foi criado/removido. Nenhuma escrita em produção, emissão fiscal, pagamento, envio de SMS ou integração SSX foi efetuado.
- A restauração do MFA no banco exige preflight, contenção/recuperação e publicação coordenada com o frontend, preservando as demais migrações locais e os consumidores.
- O isolamento próprio dos dois sistemas de toast foi implementado e validado no [checkpoint posterior de notificações](NOTIFICACOES-CONTEXTO-2026-08-30.md), ainda local. A limpeza visual não impede efeitos de comandos que já saíram do navegador.
- Permanecem Auth somente convite hospedado, revisão individual das funções privilegiadas, fiscal, GPS/geofence, anexos, demais P1/P2, publicação coordenada e teste real motorista ↔ operação. SSX continua preparado/inativo.

## Referências verificadas

- [Supabase: consulta do nível de garantia](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel).
- [Supabase: cadastro de fator MFA](https://supabase.com/docs/reference/javascript/auth-mfa-enroll).
- SDK instalado: `node_modules/@supabase/auth-js/src/GoTrueClient.ts`, métodos de consulta, cadastro, desafio e verificação; tratamento de versão de erro em `src/lib/fetch.ts`.
- [Servidor Auth: atualização da sessão após MFA](https://github.com/supabase/auth/blob/master/internal/api/token.go).
