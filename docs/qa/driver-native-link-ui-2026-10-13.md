# UI: preservar vínculo de conta username no cadastro do motorista

## Fonte e escopo

Sucessor oficial `driver-native-link-ui-20261013/CodexDriverLinkUi`, via `fork-review`, da fonte congelada `b4b2a9c6a278f3e7ae205b4fb79b84724a181ebb`, tree `36c923eb417f43a6b9ab091968faea5c85aa172d`. A fonte contém a reprodução SQL e a proposta, mas nenhuma migration aplicada. Integração e candidatos anteriores permanecem preservados.

Delta somente em `src/pages/Drivers.tsx`, teste novo `driverNativeLinkUi.test.tsx`, sucessor da testemunha `driverSharedLifecycleUiAudit.test.tsx` e esta nota. Nenhum SQL, Edge/Auth, grant, RLS, role, membership, configuração ou manifesto alterado. Sem integração/publicação.

## Comportamento

O formulário de edição consulta a inspeção V3 existente, vinculada a tenant, ator, cadastro e identidade. Exige versão 3 e o mesmo `driver_id` antes de usar a classificação.

- Conta `managed` (username nativa ou convertida): mostra vínculo somente leitura, sem opção “Sem vínculo”.
- Conta `linked`, inspeção pendente, falha ou resposta incompatível: também preserva o vínculo. Os demais dados cadastrais continuam editáveis.
- Conta `legacy` confirmada, sem comando pendente: mantém o seletor legado existente. Uma mudança explícita do vínculo exige nova inspeção imediatamente antes do UPDATE. Conversão para username, comando pendente ou falha impede qualquer gravação desse formulário nessa tentativa.
- Cadastro sem conta: mantém o formulário existente; não tenta inspecionar uma identidade alheia ou inexistente.

Edições comuns omitem `user_id` do payload. Somente uma mudança explícita do seletor compatível acrescenta esse campo, evitando reenviar uma identidade copiada do snapshot do cadastro. Mantidos os filtros de id/tenant/revisão do UPDATE. Nenhuma alteração no contrato de criação de conta ou de credenciais.

O contexto de salvamento é invalidado ao cancelar/fechar, trocar cadastro, tenant ou ator, ou desmontar o formulário por perda de permissão. Uma inspeção que conclua depois disso não dispara UPDATE. O guard local de envio evita duas revalidações/escritas por submits repetidos. Reabrir cria um novo contexto, limpa o estado de salvamento e repõe os dados atuais; a inspeção é executada novamente. O diálogo cadastral também é fechado na troca de tenant/ator/permissão, seguindo o mesmo isolamento já usado pelos diálogos de acesso.

O rótulo `legacy` não substitui autorização SQL; apenas preserva a compatibilidade da UI solicitada. Respostas restritas/ambíguas falham fechadas para mudança de vínculo. Não se presume que uma classificação obtida antes do UPDATE elimine a corrida com uma alteração externa.

## Provas

Os primeiros 12 contratos novos falharam contra a UI intacta, antes de aplicar o delta. A fonte congelada `b4b2a9c6` preserva o teste anterior que demonstrava emissão de `user_id:null`. No sucessor, essa testemunha passa a exigir ausência do seletor nativo e ausência de `user_id` no UPDATE; seu histórico e a prova SQL anterior permanecem na fonte.

18 novos casos independentes exercitam: conta username, legado compatível, conversão/pendência/erro entre seleção e gravação, vínculo restrito/erro inicial, cadastro sem conta, cancelamento/reabertura, trocas de tenant/ator/permissão, duplo submit com inspeção retida, cancelamento durante essa inspeção, respostas tardias após mudança de contexto, versão incompatível e `driver_id` estrangeiro. A testemunha atualizada acrescenta um caso. Nenhum teste existente foi removido ou convertido em skip.

Resultado final conjunto:

| Verificação | Resultado |
| --- | --- |
| `driverNativeLinkUi` + testemunha atualizada | 19 PASS |
| Ambas com `DriversAccessEntry` intacta | 52 PASS / 0 FAIL / 0 SKIP; 14,683 s |
| ESLint de `Drivers.tsx` e dois testes, `--max-warnings 0` | PASS |
| TypeScript direcionado, incluindo a página importada | PASS |

Uma execução intermediária da suíte existente foi feita equivocadamente com ambiente Node em vez de jsdom: os 33 casos falharam por `sessionStorage is not defined` antes de executar o fluxo; configuração corrigida e todos passaram. O lint identificou uma referência mutável no cleanup; foi substituída por um objeto de contexto capturado e cancelável, mantendo as contraprovas de resposta tardia. Logs intermediários preservados, sem esconder falhas.

Node local `24.19.0`, um worker, dados sintéticos, sem rede, ambiente filho explícito e envDir vazio. Não é gate de Node 22 nem suíte completa. Não foram iniciados servidores, usados Docker/WSL ou realizadas operações de gerenciamento de discos, infraestrutura ou contas reais.

## CLI: esclarecimento exato do bloqueio anterior

Não houve nova chamada à CLI nesta tarefa. O comando anterior foi:

```powershell
& 'F:/AGVLOG/work/driver-offline-combined-20261012/node_modules/@supabase/cli-windows-x64/bin/supabase.exe' migration new --help
```

Executado no sandbox padrão, sem pedido de elevação. Saída 1. Não houve negativa explícita de aprovação, política ou auto-review: foi erro de filesystem durante a tentativa de gravar telemetria, antes de mostrar ajuda.

```text
EPERM: operation not permitted, open 'C:\Users\Thomaz\.supabase\telemetry.json.tmp.276f53e3-74f5-4eb0-b358-9b3e1a002eee'
    path: "C:\\Users\\Thomaz\\.supabase\\telemetry.json.tmp.276f53e3-74f5-4eb0-b358-9b3e1a002eee",
 syscall: "open",
   errno: -4048,
    code: "EPERM"
```

O EPERM apareceu duas vezes. Transcrição dos dois blocos completos e wrappers está em `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/SUPABASE-CLI-EPERM-20261013.txt`, incluída por hash no handoff. Trechos minificados do próprio binário foram explicitamente separados dos diagnósticos; não foi lido nenhum arquivo de credenciais ou telemetria.

Houve também uma recusa do gate de coordenação ao tentar `fork-frozen`: o integrador já havia congelado a fonte durante a preparação. Nenhum conteúdo foi modificado; usou-se em seguida o `fork-review` documentado para essa condição. Isso não foi uma nova tentativa de executar a CLI nem um contorno do EPERM.

## Dependências e riscos restantes

**A UI não substitui a proteção SQL.** A proposta `driver-shared-lifecycle-link-protection-proposal.sql` herdada de `b4b2a9c6` continua byte-idêntica, fora de migrations e não aplicada. A lacuna de UPDATE/DELETE por outros caminhos persiste até revisão, empacotamento autorizado da migration e validação do candidato combinado. O botão genérico de exclusão de cadastro não foi redesenhado neste delta de desvinculação; a proteção SQL de exclusão continua necessária.

Coordenação deve congelar/revisar este sucessor, resolver o empacotamento da migration sem repetir o acesso bloqueado, compor os deltas explicitamente e executar Node 22, Native/GoTrue, RLS e concorrência. As garantias desta entrega são somente o comportamento local da UI e seus payloads; nada foi publicado e nenhuma conta real foi alterada.
