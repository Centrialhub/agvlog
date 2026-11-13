# Log de release — conferência rápida de carga

## Identidade e autorização

Usuário solicitou expressamente um clique para selecionar todas as notas, confirmar a carga e continuar, retirando exigências de segurança, lacres, fotos e avarias deste passo. Publicação Git/Vercel autorizada no histórico; checkout isolado em C: `AGV CONFERENCIA RAPIDA`, branch `codex/driver-quick-cargo-20261113`, base publicada `d2ebf5ec4ae18cb2f362d4eb24fdd94783158f4b`. Responsável: Codex. Banco AGVLog `qcvnsdrbcchaxvawcngk`, ledger inicial 950 / `20261113162405`, build anterior `68371f977682431d`.

Estado deste log: candidato. Resultado final, SHA e versões publicados serão registrados no PR. O ambiente sintético do CI é exclusivo e descartável; não são permitidas viagens, baixas, mensagens ou emissões fiscais reais para testar.

## Contrato

Tela e menu passam a “Conferência rápida”. O botão “Confirmar carga e iniciar entregas” aceita a viagem vinculada, solicita confirmação de todas as notas e executa as operações existentes de saída/início antes de abrir entregas. Não há campos obrigatórios de lacre, foto, avaria, amarração ou quantidades. A confirmação é explícita pelo motorista; não acontece ao abrir a página. Falha no início mantém o erro e permite retomar essa fase sem repetir a conferência.

Novo action `quick_confirm` na RPC existente, sem alterar assinatura, grants, tabelas, RLS, Edge ou Secrets. O servidor escolhe as notas do controle sob lock, atualiza sua fotografia esperada para incluir notas adicionadas após o aceite e marca todas as notas como conferidas. Não confia em IDs de outras cargas enviados pelo navegador. Guarda a revisão do controle, autorização de motorista/empresa, vínculo de veículo, composição da viagem, replay e auditoria. O audit registra modo rápido, IDs/contagem de documentos e ausência de exigência de verificações físicas. Não preenche flags de segurança, medições, fotos ou justificativa fictícia de ausência de lacre. Registros de avarias/lacres/evidências existentes permanecem preservados.

Os guards atuais de checklist pré-viagem, carga bloqueada, veículo/motorista atribuído, reconciliação e início confirmado continuam ativos. Funcionalidade requer internet, com explicação visível. A confirmação detalhada anterior permanece acessível por `details=1` para registros e retorno de viagens anteriores; não participa do novo caminho de início. Testes antigos foram direcionados explicitamente a essa tela preservada, mantendo suas assertions; testes novos verificam a tela que virou padrão.

## Validação

- 42 testes locais de interface, legado e SQL PGlite passaram inicialmente; ampliados para nota adicionada após aceite, consentimento explícito, stale/replay e hash da função resultante.
- SQL executa efeitos reais: todas as notas confirmadas, flags físicas falsas, quantidades não inventadas, nenhum lacre/foto, checklist ainda obrigatório e papel operador rejeitado como motorista.
- UI confirma sequência com um clique, bloqueio offline e recuperação após falha do início. Sem navegação antecipada para entregas.
- CI completo obrigatório no SHA final: validate, oito shards e database-and-e2e. Workflow acrescenta apenas o forward e contrato SQL ao mesmo PostgreSQL 17 loopback/sintético revisado. Contrato nativo em transação revertida verifica confirmação, revisão/replay e início real da fixture.
- Manifesto aditivo próprio preserva o manifesto de readiness e os 46 forwards congelados; fonte anterior e hashes/ACLs guardados em `quick-cargo-rollback-2026-11-13.sql` e `quick-cargo-sql-contract.json`.
- Leitura inicial de advisors: segurança 3, saúde 0, desempenho 7; logs agregados da RPC sem linhas no recorte padrão. Nenhum dado pessoal coletado.

## Publicação e retorno

Somente após o gate completo: confirmar fonte/hash/ACL e SHA público, aplicar SQL específico com guarda da fonte anterior, conferir nova fonte e grants, integrar a mesma árvore e verificar alias Vercel/release.json. Não usar db push nem publicar Edge Functions.

Retorno preferido: frontend anterior mantendo o backend aditivo, que continua aceitando o contrato detalhado e entende recibos rápidos já gravados. Não falsificar flags/evidências para adaptar registros rápidos ao leitor antigo. Não restaurar cegamente SQL anterior enquanto houver requests rápidos em execução. Fontes para eventual retorno revisado estão versionadas. Smoke final autenticado, se indisponível, será declarado separadamente dos testes sintéticos e da verificação pública.

## Resumo para operação

Atualize o app, abra “Conferência rápida” e toque em “Confirmar carga e iniciar entregas”. O sistema seleciona todas as notas, confirma a carga e abre as entregas. Não é preciso preencher lacre, fotos, segurança ou avarias nessa etapa.
