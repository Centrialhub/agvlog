#!/usr/bin/env python3
"""Testes do parser de assinaturas do schema-check.

Executar: python3 scripts/guardrails/test_schema_check.py
"""

import importlib.util
import os
import unittest

_SPEC = importlib.util.spec_from_file_location(
    "schema_check", os.path.join(os.path.dirname(__file__), "schema-check.py")
)
sc = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(sc)


def refs(sql):
    """Referências (GRANT/REVOKE ON FUNCTION, ALTER FUNCTION) encontradas."""
    content = sc.strip_comments(sql)
    return [
        (action, f"{q.partition('.')[0]}.{sc.normalize_signature(q.partition('.')[2], a)}")
        for _, kind, action, q, a in sc.collect_events(content)
        if kind == "ref"
    ]


def defs(sql):
    content = sc.strip_comments(sql)
    return [
        f"{q.partition('.')[0]}.{sc.normalize_signature(q.partition('.')[2], a)}"
        for _, kind, _action, q, a in sc.collect_events(content)
        if kind == "def"
    ]


# Reprodução reduzida do falso positivo de 20260722044508:
# ALTER TABLE ... ; seguido de CREATE FUNCTION era lido como "ALTER ... FUNCTION".
FALSE_POSITIVE_SQL = """
-- 1) Colunas de hold em loads
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason text NULL;

CREATE INDEX IF NOT EXISTS loads_on_hold_idx
  ON public.loads (tenant_id) WHERE on_hold = true;

-- 2) RPC: colocar carga em espera
CREATE OR REPLACE FUNCTION public.hold_load(_load_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- comentário com ponto e vírgula ; e palavra ALTER FUNCTION fake(uuid)
  UPDATE public.loads SET on_hold = true WHERE id = _load_id;
  RAISE NOTICE 'ALTER FUNCTION public.nope(uuid); GRANT EXECUTE ON FUNCTION x(int)';
END;
$$;

GRANT EXECUTE ON FUNCTION public.hold_load(uuid, text) TO authenticated;
"""

REAL_FORWARD_REF_SQL = """
GRANT EXECUTE ON FUNCTION public.not_yet_created(uuid) TO authenticated;
"""


class TestStatementSplitting(unittest.TestCase):
    def test_no_false_positive_alter_table_then_create_function(self):
        found = refs(FALSE_POSITIVE_SQL)
        self.assertEqual(
            found, [("GRANT", "public.hold_load(uuid, text)")], f"refs inesperadas: {found}"
        )
        self.assertEqual(defs(FALSE_POSITIVE_SQL), ["public.hold_load(uuid, text)"])

    def test_false_positive_file_is_clean_end_to_end(self):
        content = sc.strip_comments(FALSE_POSITIVE_SQL)
        defined = set()
        errors = []
        for offset, kind, action, qname, args in sc.collect_events(content):
            schema, _, bare = qname.partition(".")
            key = f"{schema}.{sc.normalize_signature(bare, args)}"
            if kind == "def":
                defined.add(key)
            elif key not in defined:
                errors.append((action, key, sc.line_of(content, offset)))
        self.assertEqual(errors, [])

    def test_real_forward_reference_is_detected(self):
        self.assertEqual(
            refs(REAL_FORWARD_REF_SQL), [("GRANT", "public.not_yet_created(uuid)")]
        )
        self.assertEqual(defs(REAL_FORWARD_REF_SQL), [])

    def test_alter_function_only_when_statement_head(self):
        sql = """
        CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
        ALTER FUNCTION public.f(integer) SET search_path = public;
        """
        self.assertEqual(refs(sql), [("ALTER", "public.f(integer)")])

    def test_grant_on_table_is_not_a_function_reference(self):
        self.assertEqual(refs("GRANT SELECT ON TABLE public.loads TO authenticated;"), [])
        self.assertEqual(
            refs("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;"), []
        )

    def test_multiple_targets_in_one_grant(self):
        sql = "REVOKE EXECUTE ON FUNCTION public.a(uuid), public.b(text, integer) FROM PUBLIC;"
        self.assertEqual(
            refs(sql),
            [("REVOKE", "public.a(uuid)"), ("REVOKE", "public.b(text, integer)")],
        )

    def test_string_and_dollar_quote_contents_ignored(self):
        sql = """
        INSERT INTO public.t(msg) VALUES ('GRANT EXECUTE ON FUNCTION public.ghost(uuid) TO x;');
        DO $do$
        BEGIN
          PERFORM 1;
        END
        $do$;
        """
        self.assertEqual(refs(sql), [])

    def test_signature_normalization_preserved(self):
        self.assertEqual(sc.normalize_signature("f", "_a int4, OUT _b text"), "f(integer)")
        self.assertEqual(
            sc.normalize_signature("f", "p_ids uuid[], p_val numeric(10,2) DEFAULT 0"),
            "f(uuid[], numeric)",
        )
        self.assertEqual(
            sc.normalize_signature("f", "p timestamptz, VARIADIC xs text[]"),
            "f(timestamp with time zone, text[])",
        )


class TestResetRequirement(unittest.TestCase):
    def test_db_reset_is_still_mandatory(self):
        src = open(os.path.join(os.path.dirname(__file__), "schema-check.py"), encoding="utf-8").read()
        self.assertIn("supabase db reset", src)
        self.assertIn("sys.exit(1)", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
