# Release — vínculo do CT-e na subcontratação

## Identidade e estado

Preparação, ainda não publicada. Base AGVLog `e4e4a07a9af103b53d9b751f4333b248d913ffea`, projeto `qcvnsdrbcchaxvawcngk`. Hub Fiscal `rvgcsmuyvesusbxsqevr`, repositório separado `ThomazNT/Fiscal-hub`, bundle ativo preservado com 36 módulos e ZIP SHA256 `7d6cf78407bfce50a4979cc6628a1651f5f4026f366f83310da479046dce69db`.

O usuário confirmou expressamente usar checkouts separados em C: e publicar após testes, superando a atribuição histórica da auditoria motorista em F: (unidade inexistente). Não usar serviços/réplica de revisão. Nenhuma emissão fiscal de teste ou real está autorizada neste trabalho.

## Contrato e risco

A importação permanece imutável. Novo serviço separado de tipo CT-e: normal ou subcontratação. Subcontratação exige fonte da mesma empresa/ambiente, chave modelo57, tomador contratante e trajeto original completo. Não mudar a identidade do remetente/destinatário usada no frete. Vincular metadado da fonte ao snapshot fiscal e validar no banco antes de persistir. Preservar reserva, CAS, idempotência e transporte do snapshot persistido.

O Hub hoje fixa tpServ=0 e não renderiza docAnt. A correção deve mapear serviço1 e grupos oficiais emiDocAnt/idDocAntEle, preservando origem do emitente no serviço normal. Fonte: documentação e exemplo TX2 de subcontratação da Tecnospeed.

## Gates

Pendentes: testes puros builder/TX2, interface, SQL nativo com fonte cruzada/estado obsoleto/repetição, gates completos AGVLog, revisão bundle Hub, publicação ordenada e verificação final. Fixtures exclusivamente sintéticas; nunca acionar Test no painel fiscal.

## Estado anterior e retorno

Importação PR13 e snapshot de fonte continuam compatíveis. A migração será incremental e restrita ao snapshot de subcontratação, sem mudar RPC/grants existentes. Retorno do frontend remove a criação de novos vínculos; dados e guards permanecem para preservar operações já reservadas. O Hub anterior não interpreta serviço1/docAnt: não restaurá-lo enquanto houver operações de subcontratação pendentes; bloquear novas transmissões antes de qualquer retorno.

## Comunicação operacional

Após publicação e confirmação do alias: importar original em Importação de documentos → CT-e da contratante; na prévia de emissão, aba Transporte, escolher Subcontratação, selecionar original e conferir trajeto e tomador. Transmissão fiscal é ação do operador com seus dados reais conferidos. Não anunciar conclusão enquanto os gates/publicação estiverem pendentes.

## Validação local do candidato

Node22/npm10; instalação com lockfile preservado. Builder legado + subcontratação + SQL nativo:39 casos passaram. Seleção na interface, SQL, prévia de frete, fornecedor diferente do destinatário e importação existente:49 casos passaram. Dois testes do novo manifesto passaram; os46 forwards e o manifesto da importação permanecem preservados. A fixture SQL executa `prepare_cte_issue` real e a nova trigger, com helpers de catálogo declarados; o gate hospedado ainda precisa confirmar o banco Supabase completo.

Passaram localmente lockfile/repository/release checks, pipeline (233 casos e um skip preexistente, antes dos dois testes adicionais do manifesto), lint/errors/tipos críticos, qualidade estrutural, sintaxe Edge, TypeScript e build/budget/artefato público. Mudanças posteriores pequenas na prévia ainda dependem da repetição focada e do SHA congelado hospedado.

A sessão de Supabase aberta agora tem somente a organização gatway Fiscal. A navegação ao projeto AGVLog redireciona para Organizations; será necessário voltar à conta AGVLog para aplicar o único forward incremental, depois de concluir o Hub. Nenhuma migration foi aplicada nesta rodada.
