REVOKE UPDATE ON TABLE public.occurrence_return_sheets FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.occurrence_return_sheets IS
  'Return-sheet state changes are restricted to audited SECURITY DEFINER commands; authenticated clients have no direct UPDATE privilege.';
