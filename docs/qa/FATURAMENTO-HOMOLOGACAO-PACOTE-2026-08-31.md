# Pacote fiscal para homologação — 31/08/2026

Estado: correções locais implementadas. NÃO publicado e NÃO liberado para o cliente emitir. O ensaio com provedor real continua bloqueado por credenciais de homologação ausentes e dependências de banco ainda não publicadas.

## O que foi corrigido

- NFS-e exige ambiente explícito, traduz homologation/sandbox para `homologacao` no payload e bloqueia campos obrigatórios ausentes. Não há fallback para credencial de produção.
- CT-e reserva o grupo de notas e uma prévia persistida antes do envio. Duas abas, grupos sobrepostos ou uma resposta perdida não criam outra operação. Alterar valores enquanto a operação estiver pendente exige recuperar/conferir a operação anterior.
- O servidor grava a intenção antes de chamar o Hub. Cada intenção permite um POST; resultado incerto fica reservado, sem expiração que autorize reenvio. Referência conhecida é recuperada por GET; falha ao confirmar localmente não vira sucesso na tela.
- Confirmação, estado do documento e catálogo de CT-e são atualizados em uma transação. Consulta, polling e webhook usam a mesma confirmação para novas operações; resposta tardia não reverte um estado terminal.
- Origens de homologação ficam reservadas separadamente, sem consumir marcas de emissão de produção. Não geram fontes elegíveis para cobrança real.
- A cobrança por CT-e/NFS-e exige documento autorizado de produção e evidência no registro fiscal controlado pelo servidor. Registros legados sem essa evidência não são promovidos automaticamente; exigem conciliação.
- NFS-e transmitida não pode ser editada/excluída pelo navegador enquanto seu resultado estiver pendente. Ações de recuperação consultam a operação existente; cancelamento depende da confirmação do provedor.

## Situação confirmada no servidor

Preflight de leitura em 31/08/2026 às 10:09 BRT, projeto `qcvnsdrbcchaxvawcngk`:

- Os dois emitentes ativos não possuem credencial habilitada de homologação para CT-e nem NFS-e. A existência de credenciais de produção não resolve essa falta.
- O tenant dos emitentes tem `fiscal_enabled=true` e `fiscal_kill_switch=false`; não alterados nesta tarefa.
- As quatro novas funções fiscais e as APIs de ciclo de faturas, recebimentos e fechamento não existem no servidor.
- Versões fiscais hospedadas observadas: proxy 67, webhook 46, polling CT-e 30 e polling NFS-e 34. Estes números não atestam o conteúdo local.
- Nenhum segredo foi lido/exportado. Nenhuma emissão, cancelamento, transferência, publicação ou mudança de configuração remota foi feita.

Consulta repetível: [FATURAMENTO-PREFLIGHT-2026-08-31.sql](FATURAMENTO-PREFLIGHT-2026-08-31.sql). É apenas leitura; presença de contrato/credencial não comprova certificado válido, serviço habilitado no provedor ou compatibilidade do conteúdo publicado.

## Unidade de publicação e dependências

Migração nova: `20260831124505_fiscal_emission_readiness.sql`. Depende de `_client_invoice_draft_snapshot` da migração `20260830192908_audit_client_invoice_lifecycle.sql`; não aplicar isoladamente no servidor atual.

A cadeia financeira local inclui recebimentos `20260830183929`, ciclo de fechamento `20260830174819`, rascunho atômico `20260830165149`, fontes por tentativa `20260830161722` e suas dependências operacionais. Os documentos de cada lote preservam as condições de publicação. Não é seguro executar `db push` de toda a árvore para satisfazer essa dependência.

- [Ciclo de faturas](FATURAS-CICLO-AUDITADO-2026-08-30.md)
- [Recebimentos e estornos](RECEBIMENTOS-ESTORNOS-AUDITADOS-2026-08-30.md)
- [Ciclo de fechamento](FECHAMENTO-CICLO-AUDITADO-2026-08-30.md)

Publicar, em corte coordenado e com tráfego fiscal/financeiro suspenso, a cadeia conferida de banco, as quatro Edge Functions (`hub-fiscal-proxy`, `hub-fiscal-webhook-in`, `cte-status-poll`, `nfse-status-poll`) com os helpers importados e o frontend correspondente. Manter autenticação, RLS, isolamento de ambiente e credenciais. Não promover a árvore local inteira: já continha alterações de outros lotes antes desta tarefa.

Contenção: suspender novas ações pelas capacidades existentes, preservar todas as intenções/retornos/reservas e reconciliar emissões pendentes. Não restaurar escritores antigos, apagar registros, liberar reservas sem retorno definitivo nem gerar novo identificador para contornar uma incerteza. A suspensão também pode impedir processamento de callbacks; retomar consultas/reconciliação após o corte, sem assumir que todos os callbacks foram reaplicados.

## Roteiro de aceitação com provedor real

1. Definir emitente e usuário operador; cadastrar por Configurações → Emitentes a credencial de HOMOLOGAÇÃO. Tokens/senhas nunca no chat. Conferir certificado e habilitação do serviço com o provedor.
2. Publicar o lote delimitado com suas dependências, repetir o preflight e validar a sessão autenticada. Todos os contratos exigidos devem estar presentes; comparar versões e hashes do pacote.
3. Preparar notas de teste e cadastros completos (emitente/tomador, municípios, inscrição, serviço e frete), revisar a prévia e confirmar `homologation` tanto na tela quanto no envio ao Hub.
4. Emitir um CT-e; aguardar autorização real, conferir número/protocolo/chave e baixar XML/DACTE. Reabrir a tela e recuperar a mesma operação: deve manter os IDs e não gerar segunda emissão.
5. Emitir uma NFS-e; conferir autorização, identificação, PDF e XML. A autorização e o cancelamento são dependentes do provedor/município e não foram comprovados pelos testes locais.
6. Exercitar recuperação/consulta, retorno rejeitado e cancelamento permitido em homologação, com dados próprios desse ambiente. Nunca simular a perda de confirmação apagando o registro do banco.
7. Confirmar que documentos de homologação não aparecem como elegíveis em Faturas por Cliente e que os indicadores reais das notas de origem permanecem intactos.
8. Guardar evidências redigidas por operação (ambiente, referência local/Hub, status, protocolo, resultado de download e ausência de duplicidade). Só liberar o cliente depois dessa aceitação.

O ciclo de cobrança foi exercitado com documentos sintéticos de produção em PostgreSQL local, sem emissão real. Teste de autorização real em produção exige liberação separada, revisão fiscal e operação controlada; não está implícito neste roteiro de homologação.

## Limites

- Se o provedor aceitar o documento e a conexão cair antes de persistir seu identificador, a operação permanece bloqueada. A recuperação depende do callback ou conciliação assistida pela referência `agvlog-<emission_id>` no provedor. Não há alegação de entrega exatamente uma vez em todo o sistema externo.
- Não houve validação tributária/legal de alíquotas, retenções ou enquadramentos; regras existentes foram preservadas.
- PGlite/PostgreSQL local e transporte simulado não substituem Auth/PostgREST/Edge/provedor hospedados nem E2E autenticado.

## Evidências de execução

- Suíte geral aprovada: **2.653 testes em 223 arquivos**, com paralelismo limitado e sem alterar os timeouts de teste. A primeira execução sob carga tinha um timeout em um teste de entregas; o teste isolado e a bateria completa passaram depois.
- TypeScript, lint geral e crítico, lockfile, baseline de qualidade e sintaxe das 43 Edge Functions aprovados. Baseline: 98/113 avisos explícitos de any, sem novo arquivo acima de 500 linhas.
- Build aprovado; maior chunk 488,3 KiB (limite 500 KiB), scanner sem source maps ou material secreto reconhecido. Esses scanners não provam ausência universal de segredos.
- Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches, 81,81% funções; não é cobertura integral do fiscal.
- Fiscal: 22 testes SQL da nova migração, seis testes do despacho com banco real e transporte simulado, 16 testes do proxy, 11 testes do builder NFS-e. Os 22 incluem recusa de alteração/exclusão de NFS-e incerta, liberação fiscal, ambiente, cobrança, rollback e recuperação.
- Hash da nova migração: `1c7433c6bffccd653ce0f1b0663dc60afb45f0662a62888565d761c649be1abb`. [Manifesto dos arquivos](FATURAMENTO-HOMOLOGACAO-MANIFEST-2026-08-31.json).
- **319 ensaios PostgreSQL 17.11 nativos aprovados**, código zero: 290 da cadeia anterior, seis fiscais novos e 23 de Control Tower. As disputas fiscais usaram duas conexões reais, sem transporte para o provedor. Cluster descartável encerrado.
- Dois ensaios nativos iniciais pararam no adaptador fiscal: CTE SQL de teste sem RETURNING para uma escrita e reutilização de ator sintético alterado por suítes de permissões. Corrigidos somente o adaptador e a identidade do cenário; nenhum bloqueio de autorização foi removido. A execução completa foi repetida e aprovada.
- Runtime nativo: Node 22.23.2. Tipos/lint focal final também aprovados no Node 22; lockfile e sintaxe Edge confirmados com npm 10.9.4 do cache, sem instalação ou alteração do lockfile.
- Repetição completa no Node 22.23.2 aprovada, código zero: 2.653 testes/223 arquivos e build com os mesmos limites. A invocação dessa repetição usou npm 11.17.0; nenhum pacote foi instalado. Lockfile e sintaxe foram conferidos separadamente com o npm 10.9.4 exigido pelo repositório. Diff do lote sem erros de whitespace; todos os hashes do manifesto conferidos.
