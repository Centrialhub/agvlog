DELETE FROM public.operational_routes;

INSERT INTO public.operational_routes (name, description, classification, region_name, active, destinations, tenant_id)
SELECT val.name, val.description, val.classification, val.region_name, val.active, val.destinations, t.id
FROM (VALUES
  ('MG-ARACUAI', 'ROTA 01 - MG-ARACUAI', 'municipality', 'MG-ARACUAI', true, '[{"name": "ARAÇUAÍ"}]'::jsonb),
  ('MG-BOCAIUVA', 'ROTA 02 - MG-BOCAIUVA', 'municipality', 'MG-BOCAIUVA', true, '[{"name": "BOCAIÚVA"}, {"name": "GUARACIAMA"}]'::jsonb),
  ('MG-BR. DE MINAS', 'ROTA 03 - MG-BR. DE MINAS', 'municipality', 'MG-BR. DE MINAS', true, '[{"name": "BRASÍLIA DE MINAS"}, {"name": "CAMPO AZUL"}, {"name": "SÃO ROMÃO"}, {"name": "UBAÍ"}]'::jsonb),
  ('MG-C. JESUS', 'ROTA 04 - MG-C. JESUS', 'municipality', 'MG-C. JESUS', true, '[{"name": "CLARO DOS POÇÕES"}, {"name": "CORAÇÃO DE JESUS"}, {"name": "LAGOA DOS PATOS"}, {"name": "SÃO JOÃO DA LAGOA"}, {"name": "SÃO JOÃO DO PACUÍ"}]'::jsonb),
  ('MG-CURVELO', 'ROTA 05 - MG-CURVELO', 'municipality', 'MG-CURVELO', true, '[{"name": "AUGUSTO DE LIMA"}, {"name": "BUENÓPOLIS"}, {"name": "CORINTO"}, {"name": "CURVELO"}, {"name": "ENGENHEIRO NAVARRO"}, {"name": "FRANCISCO DUMONT"}, {"name": "INIMUTABA"}, {"name": "JOAQUIM FELÍCIO"}, {"name": "MORRO DA GARÇA"}, {"name": "OLHOS-D ÁGUA"}, {"name": "PRESIDENTE JUSCELINO"}, {"name": "SANTO HIPÓLITO"}]'::jsonb),
  ('MG-DIAMANTINA', 'ROTA 06 - MG-DIAMANTINA', 'municipality', 'MG-DIAMANTINA', true, '[{"name": "CONCEIÇÃO M. DENTRO"}, {"name": "CONGONHAS DO NORTE"}, {"name": "COUTO DE M. DE MINAS"}, {"name": "DATAS"}, {"name": "DIAMANTINA"}, {"name": "FELÍCIO DOS SANTOS"}, {"name": "GOUVEIA"}, {"name": "OLHOS-D ÁGUA"}, {"name": "PRESIDENTE KUBITCHEK"}, {"name": "SENADOR M. GONÇALVES"}, {"name": "SERRO"}, {"name": "SÃO G. DO RIO PRETO"}]'::jsonb),
  ('MG-ESPINOSA', 'ROTA 07 - MG-ESPINOSA', 'municipality', 'MG-ESPINOSA', true, '[{"name": "CATUTI"}, {"name": "ESPINOSA"}, {"name": "GAMELEIRAS"}, {"name": "MAMONAS"}, {"name": "MATO VERDE"}, {"name": "MONTE AZUL"}, {"name": "PAI PEDRO"}]'::jsonb),
  ('MG-FRANCISCO SA', 'ROTA 08 - MG-FRANCISCO SA', 'municipality', 'MG-FRANCISCO SA', true, '[{"name": "BOTUMIRIM"}, {"name": "CRISTÁLIA"}, {"name": "FRANCISCO SÁ"}, {"name": "GRÃO MOGOL"}]'::jsonb),
  ('MG-ITACAMBIRA', 'ROTA 09 - MG-ITACAMBIRA', 'municipality', 'MG-ITACAMBIRA', true, '[{"name": "GLAUCILÂNDIA"}, {"name": "ITACAMBIRA"}, {"name": "JURAMENTO"}]'::jsonb),
  ('MG-JAIBA', 'ROTA 10 - MG-JAIBA', 'municipality', 'MG-JAIBA', true, '[{"name": "JAÍBA"}, {"name": "JUVENÍLIA"}, {"name": "MANGA"}, {"name": "MATIAS CARDOSO"}, {"name": "MIRAVÂNIA"}, {"name": "MONTALVÂNIA"}, {"name": "VERDELÂNDIA"}]'::jsonb),
  ('MG-JANAUBA', 'ROTA 11 - MG-JANAUBA', 'municipality', 'MG-JANAUBA', true, '[{"name": "CAPITÃO ENÉAS"}, {"name": "JANAÚBA"}, {"name": "NOVA PORTEIRINHA"}]'::jsonb),
  ('MG-JANUARIA', 'ROTA 12 - MG-JANUARIA', 'municipality', 'MG-JANUARIA', true, '[{"name": "BONITO DE MINAS"}, {"name": "CÔNEGO MARINHO"}, {"name": "ITACARAMBI"}, {"name": "JANUÁRIA"}, {"name": "LONTRA"}, {"name": "PEDRAS DE M. DA CRUZ"}, {"name": "SÃO JOÃO DAS MISSÕES"}]'::jsonb),
  ('MG-MC-001', 'ROTA 13 - MG-MC-001', 'municipality', 'MG-MC-001', true, '[{"name": "MONTES CLAROS"}]'::jsonb),
  ('MG-MIRABELA', 'ROTA 14 - MG-MIRABELA', 'municipality', 'MG-MIRABELA', true, '[{"name": "MIRABELA"}]'::jsonb),
  ('MG-PIRAPORA', 'ROTA 15 - MG-PIRAPORA', 'municipality', 'MG-PIRAPORA', true, '[{"name": "BURITIZEIRO"}, {"name": "IBIAÍ"}, {"name": "JEQUITAÍ"}, {"name": "LASSANCE"}, {"name": "PIRAPORA"}, {"name": "PONTO CHIQUE"}, {"name": "VÁRZEA DA PALMA"}]'::jsonb),
  ('MG-PORTEIRINHA', 'ROTA 16 - MG-PORTEIRINHA', 'municipality', 'MG-PORTEIRINHA', true, '[{"name": "PORTEIRINHA"}, {"name": "RIACHO DOS MACHADOS"}, {"name": "SERRANÓPILIS DE MINA"}]'::jsonb),
  ('MG-SALINAS', 'ROTA 17 - MG-SALINAS', 'municipality', 'MG-SALINAS', true, '[{"name": "CURRAL DE DENTRO"}, {"name": "FRUTA DE LEITE"}, {"name": "JOSENÓPOLIS"}, {"name": "NOVORIZONTE"}, {"name": "PADRE CARVALHO"}, {"name": "RUBELITA"}, {"name": "SALINAS"}, {"name": "SANTA C. DE SALINAS"}, {"name": "SANTA CRUZ DE MINAS"}]'::jsonb),
  ('MG-SAO FRANCISC', 'ROTA 18 - MG-SAO FRANCISC', 'municipality', 'MG-SAO FRANCISC', true, '[{"name": "ICARAÍ DE MINAS"}, {"name": "LUISLÂNDIA"}, {"name": "PINTÓPOLIS"}, {"name": "SÃO FRANCISCO 31"}]'::jsonb),
  ('MG-SAO J. D. PA', 'ROTA 19 - MG-SAO J. D. PA', 'municipality', 'MG-SAO J. D. PA', true, '[{"name": "INDAIABIRA"}, {"name": "MONTEZUMA"}, {"name": "NINHEIRA"}, {"name": "RIO PARDO DE MINAS"}, {"name": "SANTO A. DO RETIRO"}, {"name": "SÃO J. DO PARAÍSO"}, {"name": "VARGEM G. RIO PARDO"}]'::jsonb),
  ('MG-SAO J. D. PO', 'ROTA 20 - MG-SAO J. D. PO', 'municipality', 'MG-SAO J. D. PO', true, '[{"name": "IBIRACATU"}, {"name": "JAPONVAR"}, {"name": "PATIS"}, {"name": "SÃO JOÃO DA PONTE"}, {"name": "VARZELÂNDIA"}]'::jsonb),
  ('MG-TAIOBEIRAS', 'ROTA 21 - MG-TAIOBEIRAS', 'municipality', 'MG-TAIOBEIRAS', true, '[{"name": "BERIZAL"}, {"name": "TAIOBEIRAS"}]'::jsonb)
) AS val(name, description, classification, region_name, active, destinations)
CROSS JOIN public.tenants t;