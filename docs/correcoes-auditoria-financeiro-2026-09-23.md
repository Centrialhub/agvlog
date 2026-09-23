# Correções da auditoria financeira — 23/09/2026

## Segunda verificação — resultado atualizado

A revisão posterior encontrou quatro falhas que a primeira bateria não cobria, reproduzidas por testes que falharam antes da correção:

1. Aprovar e aumentar o valor na mesma gravação comparava a alçada com o valor antigo.
2. Aumentar o valor de um título já aprovado preservava sua aprovação, mesmo com alçadas ativas.
3. Alterar a identificação do preparador em uma gravação separada permitia contornar a separação entre preparação e aprovação.
4. Duas instâncias de uma tela compartilhavam o controle de recuperação; uma leitura da segunda podia permitir que a primeira apagasse o pedido errado.

As quatro foram corrigidas. O banco verifica o valor final e exige nova revisão para mudar valor ou favorecido de um título aprovado quando a política está ativa. Criador e último editor passam a ser preservados/definidos pelo servidor nas gravações autenticadas. A recuperação agora pertence à instância da decisão, rejeita descarte de outro pedido e remove cópias antigas de sessão após a migração para o armazenamento persistente.

A migration complementar **`20260923134704_finance_approval_final_value_guard.sql`** foi aplicada ao projeto ativo. Nenhuma configuração de alçada foi ativada: continuam **zero políticas cadastradas**, e a prévia autenticada de aprovação consultada no banco continua com `can_execute=true`.

**169 testes passaram em 31 arquivos** na bateria ampliada. A checagem de tipos, o lint dos arquivos alterados, a compilação verificada e o contrato de publicação do Supabase passaram. O cenário de descarte de recuperação foi novamente validado após o tratamento das mensagens de conflito. Os totais dos advisors de segurança e desempenho permaneceram iguais aos da primeira rodada.

**O frontend continua sem publicação.** Não houve teste de aceitação visual autenticado nem gravação de dados financeiros reais para validar os cenários; estes foram reproduzidos em banco de teste com dados sintéticos. As 155 pendências fiscais registradas na primeira rodada não foram resolvidas por esta revisão. Evidências: [finance-audit-doublecheck-20260923.json](F:/agvlog-main/docs/qa/finance-audit-doublecheck-20260923.json).

As seções abaixo preservam o histórico da primeira rodada, incluindo sua bateria original de 141 testes.

## Resultado

As falhas de gravação manual, concorrência, cobertura de faturas e renderização da cobrança foram corrigidas. Também foram entregues a fila fiscal por documento, alçadas opcionais, recuperação durável das decisões de conciliação/fechamento e melhorias de navegação.

As quatro migrations desta rodada foram aplicadas ao projeto ativo `qcvnsdrbcchaxvawcngk`. **O frontend não foi publicado.** As telas novas estão no workspace e dependem da publicação do candidato validado.

## Correções por achado

| Auditoria | Entrega |
|---|---|
| 2 — Cobrança | Import de `DataPagination` corrigido; teste renderiza e pagina as abas de faturas elegíveis e histórico. Os nove diagnósticos TypeScript registrados anteriormente foram corrigidos. |
| 3 — Criação manual | Cadastro de pagar/receber usa comando atômico com identidade durável, recuperação da resposta original e trava entre abas. Possível duplicidade exige justificativa para um novo título legítimo. A origem manual e o autor são definidos pelo servidor. |
| 4 — Edição concorrente | Revisão esperada obrigatória em receber e pagar. Edição desatualizada é recusada sem sobrescrever a anterior; formulário preservado e histórico com antes/depois. A aprovação continua exigindo seu comando próprio. |
| 5 — Faturas acima de 500 | Nova consulta paginada no servidor, 30 linhas por página, busca e totais sobre todo o conjunto filtrado, revisão entre páginas e verificação financeira preservada. Removido o cruzamento com uma segunda lista ilimitada. |
| 6 — Fila fiscal | Visão atual por emissão separada do histórico; idade do registro, responsável, prazo, encaminhamento e link para CT-e/NFS-e. Atribuição tem controle de revisão e recuperação idempotente. O operador assume a revisão em seu próprio nome. |
| 7 — Permissões/alçadas | Botões de cadastro/edição de recebíveis alinhados a admin/owner. Regra de aprovação existente preservada por padrão; alçadas por perfil e separação de preparador/aprovador são opcionais e verificadas no banco. |
| 8 — Recuperação | Central de pedidos/rascunhos por empresa e usuário, incluindo os armazenamentos existentes e a importação de extrato. Conciliação, reversão de conciliação, fechamento bancário e fechamento de caixa migram o pedido antigo da aba para armazenamento durável; novos envios são serializados entre abas. |
| 9 — Uso diário | Os 17 destinos foram preservados em três grupos. Filtros de pagar, faturas e fila fiscal são reproduzíveis por URL. Faturas e fila fiscal explicitam o alcance dos indicadores. |
| 10 — Manutenção | Comando manual, recuperação, persistência de decisões e inventário de pendências extraídos para unidades próprias. Removidos os hooks sem consumidores que buscavam todas as contas a pagar/receber. Novos módulos formatados. Não foi feita uma reescrita dos demais componentes extensos. |

Também foram aplicadas a restrição positiva do valor de contas a pagar, a política de edição direta apenas para títulos sem origem operacional e a identificação/auditoria do editor material. A constraint foi validada sobre os registros existentes, sem precisar alterar valores históricos. Três funções de acerto perderam a permissão de execução anônima; o acesso autenticado existente foi preservado.

## Alçadas: configuração e regra preservada

Em **Contas a pagar → Alçadas de aprovação**, administradores podem configurar:

- Ativação explícita da política.
- Limite por aprovação para operador e administrador; campo vazio significa sem teto e zero impede aprovações de valor positivo naquele perfil.
- Exigência de aprovador diferente do criador ou último editor.
- Motivo obrigatório, histórico da mudança e revisão para impedir sobrescrita concorrente.

Proprietários não têm teto de valor, mas seguem a separação de preparador/aprovador quando ativada. A política não concede novas permissões. Não foi ativado nenhum limite nem criado um fluxo de duas assinaturas: foi mantida a regra atual, conforme a decisão do usuário.

## Banco ativo

| Versão registrada | Migration |
|---|---|
| `20260923132052` | `finance_audit_manual_title_commands` |
| `20260923132100` | `finance_audit_invoice_pagination` |
| `20260923132108` | `finance_audit_fiscal_work_queue` |
| `20260923132117` | `finance_configurable_approval_limits` |

Os arquivos locais usam as versões efetivamente registradas. Não foi executado um envio indiscriminado da cadeia histórica de migrations.

As verificações remotas, em transação somente de leitura com papel autenticado, confirmaram:

- Nova página de faturas, fila fiscal atual, histórico fiscal, leitura da política e prévia de aprovação existentes respondendo.
- 155 documentos atuais em revisão, em vez de tratar as 173 observações históricas em revisão como documentos distintos.
- Política padrão desativada e prévia real de conta a pagar com `can_execute=true`.
- Seis novas RPCs públicas com execução autenticada e sem execução anônima; wrappers públicos sem `SECURITY DEFINER`.
- Constraint de valor positivo validada e três triggers de auditoria/alçada presentes.
- Revogação do acesso anônimo às três funções de acerto.

Nenhum título, pagamento, aprovação, atribuição ou configuração real foi criado para testar produção. A empresa da amostra remota não possui faturas; a cobertura com 501 e 10.000 registros foi ensaiada com dados sintéticos.

## Validação

- **141 testes passaram em 28 arquivos**, abrangendo SQL, recuperação, permissões, revisão concorrente, telas, navegação e regressões de baixa por conta, exclusão e centro de custo.
- `npm run typecheck`: aprovado, sem diagnósticos.
- ESLint dos arquivos de implementação e novos testes desta rodada: sem erros.
- `npm run build:check`: aprovado, incluindo inspeção do bundle e ausência de mapas de origem/material secreto reconhecido no artefato público.
- `npm run supabase:release:check`: aprovado.
- No ensaio PGlite com 10.000 faturas, a primeira consulta levou aproximadamente 4,1 segundos após atualizar as estatísticas da massa sintética. Isso não é um compromisso de latência em produção. Não foi feito teste de carga concorrente.

Os fixtures executam definições do banco ativo com registros sintéticos e dependências dirigidas aos fluxos testados. Não constituem uma réplica integral de todas as políticas, triggers e integrações da produção, nem substituem uma homologação visual autenticada do candidato publicado.

## Limites e acompanhamento

**As 155 pendências fiscais continuam abertas.** A nova fila organiza sua resolução; protocolo, valores e pagador precisam ser conferidos na origem. Nenhuma evidência fiscal foi inventada e nenhum documento foi declarado resolvido automaticamente.

A central encaminha às telas de origem e identifica o registro local. A retomada e validação do resultado continuam nos controles específicos de cada operação. Fluxos antigos que ainda usam armazenamento de aba são identificados como “Disponível somente nesta aba”; não foi prometida persistência universal para eles. Não há sincronização dos pedidos locais entre dispositivos.

As propostas de novos produtos da auditoria — cobrança com promessas, recorrência, simulação de tesouraria e uma matriz inteiramente nova de capacidades — não foram convertidas em funcionalidades nesta correção. A refatoração dos demais componentes extensos continua como evolução de manutenção.

O advisor de segurança passou de cinco para dois avisos de funções públicas executáveis por anônimo. Permanecem avisos preexistentes, sem certificado geral de segurança. Os dois novos avisos informativos de RLS sem políticas são das tabelas **privadas**, sem acesso direto aos papéis da API, manipuladas exclusivamente pelos comandos validados. Referências: [execução de funções](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) e [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Evidências remotas e resumo dos advisors: [finance-audit-remediation-20260923.json](F:/agvlog-main/docs/qa/finance-audit-remediation-20260923.json).
