import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const parseGatewayError = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    const type = typeof parsed?.type === "string" ? parsed.type : "";
    const message = typeof parsed?.message === "string" ? parsed.message : "";
    const details = typeof parsed?.details === "string" ? parsed.details : "";

    if (type === "credit_limit_reached") {
      return {
        status: 402,
        error: "Limite de créditos do workspace para IA atingido. Peça ao proprietário do workspace para ajustar o limite ou adicionar créditos antes de tentar ler a NF-e/ORT novamente.",
      };
    }

    return {
      status: Number(parsed?.status) || 500,
      error: details || message || "Falha no gateway de IA ao extrair a NF-e/ORT.",
    };
  } catch {
    return {
      status: 500,
      error: raw ? `Falha no gateway de IA ao extrair a NF-e/ORT: ${raw.slice(0, 220)}` : "Falha no gateway de IA ao extrair a NF-e/ORT.",
    };
  }
};

type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return jsonResp({ error: "Lovable AI não configurado" }, 500);

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const files = Array.isArray(body?.files) ? body.files : [];
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
    if (!tenantId) return jsonResp({ error: "Tenant obrigatório" }, 400);
    const { data: membership, error: membershipError } = await anonClient
      .from("tenant_memberships")
      .select("tenant_id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .in("role", ["owner", "admin", "operator"])
      .maybeSingle();
    if (membershipError || !membership) return jsonResp({ error: "Sem acesso ao tenant informado" }, 403);

    if (files.length === 0 || files.length > 5) return jsonResp({ error: "Envie de 1 a 5 imagens/PDFs da NF-e ou ORT" }, 400);

    // Guard rails para o AI Gateway: rejeita cedo se o payload for grande demais
    // (a Gemini via chat-completions aceita ~4 MB por parte inline). Base64 =
    // ~1.37 × tamanho binário. 4 MB base64 ≈ 3 MB de arquivo original.
    const PER_FILE_LIMIT = 4 * 1024 * 1024;
    const TOTAL_LIMIT = 8 * 1024 * 1024;
    let totalBytes = 0;
    for (const f of files) {
      const size = typeof f?.base64 === "string" ? f.base64.length : 0;
      totalBytes += size;
      if (size > PER_FILE_LIMIT) {
        return jsonResp({
          error: `Arquivo "${f?.name || "sem nome"}" muito grande para leitura por IA (limite ~3 MB). Reduza a resolução do scan ou envie páginas separadas.`,
        }, 413);
      }
    }
    if (totalBytes > TOTAL_LIMIT) {
      return jsonResp({ error: "Conjunto de arquivos maior que ~6 MB. Envie em lotes menores." }, 413);
    }

    const content: AiContentPart[] = [{
      type: "text",
      text: [
        "Extraia dados de DANFEs de NF-e e de ORTs brasileiras sem misturar os dois tipos.",
        "Defina documentKind='nfe' somente quando o documento for uma DANFE/NF-e e documentKind='ort' quando for uma ordem/romaneio de transporte.",
        "Para NF-e, extraia accessKey com exatamente os 44 dígitos impressos; se qualquer dígito estiver ilegível, retorne string vazia, confiança 0 e needsReview=true. ORT não possui chave NF-e: retorne accessKey vazio.",
        "Os arquivos podem conter scans de várias páginas do mesmo documento: agrupe somente quando a identidade (chave NF-e, ou número ORT + emitente + destinatário) coincidir.",
        "Totais da NF/ORT são totais do documento e podem se repetir em várias páginas: retorne-os uma única vez, nunca some cabeçalhos/totais repetidos. Não duplique linhas idênticas de itens.",
        "Quando claramente forem documentos diferentes, retorne um documento por NF-e/ORT.",
        "Em sourcePages liste os nomes dos arquivos que compõem o documento e em pageCount informe quantas páginas foram unidas.",
        "Extraia também: número do documento (invoiceNumber), data de emissão (issueDate em YYYY-MM-DD), prazo de pagamento (paymentTerms — ex.: 'À VISTA', '30 DIAS', '30/60/90'), forma/responsável de cobrança (billing — ex.: 'CIF', 'FOB', 'Pago', 'A pagar', cliente faturado), descrição da carga (cargoDescription — natureza/tipo de mercadoria), telefone do cliente/destinatário (recipientPhone), endereço (recipientAddress — logradouro), número do endereço (recipientAddressNumber), complemento (recipientAddressComplement), bairro, cidade, UF, CEP (recipientZip), código IBGE do município (recipientCityCode quando visível), país (recipientCountry) e código do país (recipientCountryCode).",
        "Extraia também dados cadastrais do destinatário quando legíveis: nome fantasia (recipientFantasyName), Inscrição Estadual (recipientStateRegistration — use 'ISENTO' quando indicado), Inscrição Municipal (recipientMunicipalRegistration), indicador de IE (recipientIeIndicator: '1' contribuinte ICMS, '2' isento, '9' não contribuinte) e e-mail do destinatário (recipientEmail).",
        "Quando houver tabela/lista de mercadorias, extraia múltiplos itens com descrição, quantidade, unidade, valor unitário, valor total, peso e volume quando legíveis. Não invente itens nem resumo: se a lista estiver ilegível, retorne items vazio e productSummary vazio.",
        "Preencha sourceFileName com o arquivo principal e sourcePages com todos os arquivos agrupados. Use confidence 0-1 e needsReview=true se algum campo essencial estiver ilegível.",
        "REGRA CRÍTICA DE FALLBACK: NUNCA invente CEP, telefone, número de endereço, CNPJ ou logradouro. Se o campo estiver totalmente ilegível, parcialmente cortado, manuscrito impreciso, ou se você tiver menos de 70% de confiança naquele dígito/caractere específico, retorne literalmente a string 'UNKNOWN' (em maiúsculas) e marque fieldConfidences[campo]=0 e needsReview=true. Não tente completar dígitos faltantes em CEP (sempre 8 dígitos) nem em telefone (sempre 10/11 dígitos com DDD); se faltar qualquer dígito, retorne 'UNKNOWN'.",
      ].join(" "),
    }];

    for (const file of files) {
      if (!file?.base64 || !file?.mimeType || !file?.name) return jsonResp({ error: "Arquivo ORT inválido" }, 400);
      content.push({ type: "text", text: `Arquivo: ${file.name}` });
      const isPdf = String(file.mimeType).toLowerCase() === "application/pdf"
        || String(file.name).toLowerCase().endsWith(".pdf");
      const mime = isPdf ? "application/pdf" : file.mimeType;
      // Gemini via Lovable AI Gateway (formato compatível OpenAI) aceita PDFs
      // e imagens usando `image_url` com data URL. Para PDFs, o gateway repassa
      // como inlineData para o Gemini.
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${file.base64}` } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você extrai DANFEs de NF-e e ORTs logísticas com precisão. Não invente dados; deixe campos vazios e marque revisão quando houver dúvida." },
          { role: "user", content },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_fiscal_scan_documents",
            description: "Retorna NF-e e ORTs extraídas, preservando a identidade real de cada tipo.",
            parameters: {
              type: "object",
              properties: {
                documents: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      documentKind: { type: "string", enum: ["nfe", "ort"] },
                      accessKey: { type: "string", description: "Chave de acesso de 44 dígitos somente para NF-e; vazia para ORT ou leitura incompleta." },
                      invoiceNumber: { type: "string" },
                      issueDate: { type: "string" },
                      paymentTerms: { type: "string", description: "Prazo/condição de pagamento (ex.: À VISTA, 30 DIAS, 30/60/90)." },
                      billing: { type: "string", description: "Tipo/responsável da cobrança (CIF, FOB, A pagar, Pago, cliente faturado)." },
                      cargoDescription: { type: "string", description: "Descrição/natureza da carga transportada." },
                      emitterName: { type: "string" },
                      emitterCnpj: { type: "string" },
                      recipientName: { type: "string" },
                      recipientCnpj: { type: "string" },
                      recipientPhone: { type: "string", description: "Telefone do cliente/destinatário com DDD." },
                      recipientCity: { type: "string" },
                      recipientState: { type: "string" },
                      recipientAddress: { type: "string" },
                      recipientAddressNumber: { type: "string", description: "Número do endereço do destinatário." },
                      recipientZip: { type: "string", description: "CEP do destinatário." },
                      recipientNeighborhood: { type: "string" },
                      recipientAddressComplement: { type: "string", description: "Complemento do endereço (sala, andar, bloco)." },
                      recipientCityCode: { type: "string", description: "Código IBGE do município (7 dígitos) quando visível." },
                      recipientCountry: { type: "string", description: "País do destinatário quando explicitamente legível." },
                      recipientCountryCode: { type: "string", description: "Código BACEN do país quando explicitamente legível." },
                      recipientFantasyName: { type: "string", description: "Nome fantasia do destinatário." },
                      recipientStateRegistration: { type: "string", description: "Inscrição Estadual (use 'ISENTO' quando indicado)." },
                      recipientMunicipalRegistration: { type: "string", description: "Inscrição Municipal." },
                      recipientIeIndicator: { type: "string", description: "Indicador IE: '1' contribuinte ICMS, '2' isento, '9' não contribuinte." },
                      recipientEmail: { type: "string", description: "E-mail do destinatário quando informado." },
                      totalValue: { type: "number" },
                      totalWeight: { type: "number" },
                      totalVolume: { type: "number" },
                      estimatedPallets: { type: "number" },
                      productSummary: { type: "string" },
                      items: {
                        type: "array",
                        description: "Mercadorias/produtos identificados na ORT; vazio quando a imagem não permitir leitura confiável.",
                        items: {
                          type: "object",
                          properties: {
                            description: { type: "string" },
                            quantity: { type: "number" },
                            unit: { type: "string" },
                            unitPrice: { type: "number" },
                            totalPrice: { type: "number" },
                            weightKg: { type: "number" },
                            volumeM3: { type: "number" },
                            confidence: { type: "number" },
                          },
                          required: ["description"],
                          additionalProperties: false,
                        },
                      },
                      confidence: { type: "number" },
                      needsReview: { type: "boolean" },
                      fieldConfidences: {
                        type: "object",
                        description: "Confiança por campo, de 0 a 1, usando os nomes dos campos retornados.",
                        additionalProperties: { type: "number" },
                      },
                      sourceFileName: { type: "string" },
                      sourcePages: {
                        type: "array",
                        description: "Lista de nomes de arquivos que compõem o documento (multi-página/scan).",
                        items: { type: "string" },
                      },
                      pageCount: { type: "number", description: "Número de páginas/folhas que foram unidas neste documento." },
                    },
                    required: ["documentKind", "accessKey", "invoiceNumber", "recipientName", "recipientCity", "recipientState", "confidence", "needsReview"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["documents"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_fiscal_scan_documents" } },
      }),
    });

    if (aiResp.status === 429) return jsonResp({ error: "Limite da IA atingido, tente novamente em instantes." }, 429);
    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      console.error("[extract-ort] AI gateway error", aiResp.status, errText.slice(0, 800));
      const parsedError = parseGatewayError(errText);
      return jsonResp({ error: parsedError.error }, parsedError.status);
    }

    const aiJson = await aiResp.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) console.warn("[extract-ort] Resposta sem tool_call", JSON.stringify(aiJson).slice(0, 500));
    return jsonResp(args ? JSON.parse(args) : { documents: [] });
  } catch (e) {
    console.error("[extract-ort] exception", e);
    return jsonResp({ error: e instanceof Error ? e.message : "Erro ao processar NF-e/ORT" }, 500);
  }
});
