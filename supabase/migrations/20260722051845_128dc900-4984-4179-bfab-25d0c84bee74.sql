
-- Desativa rotas legadas MG-* cujas cidades já são cobertas por rotas ROTA - *
UPDATE public.operational_routes
   SET active = false, updated_at = now()
 WHERE active = true
   AND name IN ('MG-C. JESUS','MG-FRANCISCO SA','MG-ITACAMBIRA','MG-MIRABELA','MG-SAO J. D. PO');
