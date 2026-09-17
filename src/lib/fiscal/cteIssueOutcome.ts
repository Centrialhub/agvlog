export class DefinitiveCteIssueError extends Error {
  readonly definitive = true;

  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveCteIssueError';
  }
}

export function isDefinitiveCteIssueError(error: unknown): boolean {
  return error instanceof DefinitiveCteIssueError
    || Boolean(error && typeof error === 'object' && 'definitive' in error && error.definitive === true);
}