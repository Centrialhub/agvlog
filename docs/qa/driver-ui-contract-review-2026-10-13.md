# Revisão dos nove testes de interface do candidato combinado

## Escopo e origem

Base congelada: `6ae6bb2e4888a2475ef7b34653647c67ededa9bd`, tree `c9ff832e7c4df2d02cce79ccc573c12abebb1591`, tarefa `driver-offline-combined-20261012/CodexMerge`.

Fork oficial: `driver-ui-contract-review-20261013/CodexDriverUiReview`, criado por `fork-review` após validação do handoff da base. SHA-256 do handoff recebido: `f81b71c105371e1c72d7c3c03f7493ffdd6e64879bfe10bb908fd711c25080a0`.

Delta limitado a `src/test/DriversAccessEntry.test.tsx`, `src/test/driverUsernameAccess.test.tsx` e esta nota. Nenhuma alteração em componentes, Auth/Edge, SQL, credenciais, roles, RLS, dados, migrations ou manifests. Nenhuma publicação, integração, acesso produtivo, deleção ou desvinculação executada.

## Resultado e classificação das nove falhas

As mesmas nove falhas foram reproduzidas antes da correção: 43 PASS / 9 FAIL nas duas suítes (52 testes). Nenhum defeito produtivo foi demonstrado por estas nove falhas. O código da base já exige inspeção V3, identificação das mutações de credenciais e reconciliação antes de nova alteração.

| Quantidade | Testes / causa comprovada | Correção do teste |
| --- | --- | --- |
| 3 | Abertura por owner/admin e seleção de motorista: payload esperado não incluía `version: 3`. | Igualdade exata com V3; fixture responde capabilities explícitas, sem permitir delete/unlink. |
| 3 | Reabertura offline no mesmo contexto/retorno de contexto e nova tentativa após recusa: esperavam mensagem antiga e formulário desabilitado. A barreira atual remove o formulário. | Exigir mensagem atual, ausência de formulário/campos/botão de criar e nenhuma segunda mutação ao verificar; preservar cache `none` obsoleto, consulta pausada, reabertura, retorno de contexto, reconexão e inspeção nova bem-sucedida. |
| 1 | Troca de senha: payload esperado não incluía `request_id`; mock retornava `{success:true}` também para `credential_status`, sem recibo válido. | UUID determinístico, payload completo, consulta de status com o mesmo UUID e recibo terminal correspondente; somente uma escrita. |
| 2 | Restrição da conta legada e senha divergente: estado pendente persistido pelo caso anterior em `sessionStorage` contaminava a suíte. Ambos passaram isoladamente na base, antes do patch. | Limpar estado apenas entre testes, encerrar QueryClients e fornecer fixtures V3 coerentes. Restrição legada agora exige instrução de preservar vínculos, sem sugerir exclusão/recriação. |

O componente conserva a solicitação em cache e `sessionStorage` por tenant/alvo/ator. Depois de uma tentativa de credencial, `driverCredentialStatusRequest` só aceita `succeeded`/`cancelled` com o mesmo `request_id`; a inspeção subsequente precisa também concluir. A fixture antiga não fornecia esse recibo. A limpeza entre casos não ocorre dentro dos cenários de fechar/reabrir e não oculta a persistência sob teste.

Pontos produtivos observados, sem alteração: `src/components/drivers/DriverAccessControls.tsx` (persistência, save, reconciliação e barreira), `src/lib/auth/driverAccess.ts` (contrato do recibo), `src/hooks/useRefreshDriverAccess.ts` (refetch após mutação).

## Contraprovas mantidas e ampliadas

Nenhum teste removido, pulado ou marcado como falha esperada. Mantidos duplo envio, cancelamento/fechamento, troca de contexto/permissão, término tardio, resposta perdida, inspeção indisponível, reabertura offline e nova tentativa somente após confirmação. A barreira passa a ser testada pela ausência total do formulário, em vez da possibilidade antiga de tentar enviar um formulário desabilitado.

Quatro casos novos de troca de senha exercitam recibos `pending`, `unconfirmed`, `not_found` e `succeeded` de outro UUID. Cada caso força dois submits enquanto a resposta está pendente, simula timeout da resposta, fecha/reabre com QueryClient novo e estado persistido, faz nova consulta ainda inválida e finalmente recebe `succeeded` do UUID original. Exige: uma única mutação, mesmo UUID em todas as consultas, apenas um UUID gerado, nenhum formulário enquanto incerto, senha ausente do armazenamento persistente e campos vazios após confirmação. A suíte adjacente existente também cobre recibo `cancelled`.

Os mocks de acesso rejeitam ações inesperadas e não implementam um sucesso genérico para qualquer chamada. O teste já existente do painel legado permanece inteiramente simulado; nenhuma exclusão real foi realizada.

## Evidência local

| Execução | Resultado |
| --- | --- |
| Base intocada, duas suítes | 43 PASS / 9 FAIL / 0 SKIP |
| Dois casos em cascata isolados na base | 2 PASS; outros 17 filtrados pelo nome, não executados |
| Duas suítes após fixtures, antes das contraprovas adicionais | 52 PASS / 0 FAIL / 0 SKIP |
| Username + quatro contraprovas adicionais | 23 PASS / 0 FAIL / 0 SKIP |
| Quatro suítes de UI juntas, delta final | 65 PASS / 0 FAIL / 0 SKIP, 11,272 s de processo |
| ESLint nos dois arquivos alterados, `--max-warnings 0` | PASS |
| TypeScript, entradas nos dois testes + setup/vite-env e dependências importadas | PASS |

Quatro suítes: `DriversAccessEntry`, `driverUsernameAccess`, `driverWorkspaceCredentialsUi`, `driverSharedAccessCapabilities`. Runner com um worker, sem paralelismo entre arquivos, cache desativado, diretório de env vazio, ambiente filho explícito e preload bloqueando fetch/http/https/net/tls. Dados e endpoint sintéticos, sem servidor iniciado. Dependências existentes acessadas pela junction do fork; nenhuma instalação. Logs, JSONs e recibos ficam em `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/ui-review/` e são inventariados no handoff selado externo.

Runtime local: Node `24.19.0`. A base foi avaliada pelo coordenador em Node `22.23.2`, e o projeto requer Node 22; estes testes não substituem a validação do runtime de release. Não houve reexecução da suíte completa nem dos 232 testes driver do coordenador. O full anterior 8.533 PASS / 9 FAIL / 1 SKIP pertence à base, não a este novo SHA.

## Segurança e limites de entrega

O patch não escolhe tenant, cria membership, reduz ACL/RLS nem muda o escopo de identidades. Preserva a separação cadastro/acesso e proíbe, nas novas expectativas, oferecer exclusão ou desvinculação como solução. A atualização dos fixtures alinha testes com as capabilities e barreiras já presentes no candidato combinado.

Entrega é um delta de testes para revisão e composição exclusiva pelo coordenador. Mantidos o candidato combinado congelado, a integração `50b6fe92a5501aac9588eec7b88d47dc3a21cf38` e o pin publicado `df6dfd513098ff8967256ae9a2bbad8118fa35cd`. Não se presume publicação de patch2. Manifest/forward inventário e Native/Postgres/GoTrue/ACL/RLS/concorrência permanecem fora deste escopo e pendentes dos respectivos responsáveis. A validação final deve ocorrer no novo SHA combinado, em Node 22, antes de qualquer decisão de publicação.
