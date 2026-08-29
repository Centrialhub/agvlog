export function getErrorMessage(error: unknown, fallback = 'Ocorreu um erro inesperado.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
