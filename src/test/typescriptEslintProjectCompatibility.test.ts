// @vitest-environment node
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCaches, parseForESLint } from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

let fixtureRoot: string;
beforeEach(() => {
  clearCaches();
  fixtureRoot = mkdtempSync(join(tmpdir(), 'agvlog-p2-eslint-'));
});
afterEach(() => {
  clearCaches();
  const absolute = realpathSync(fixtureRoot);
  if (dirname(absolute) !== realpathSync(tmpdir()) || !basename(absolute).startsWith('agvlog-p2-eslint-')) {
    throw new Error('Refusing cleanup outside the own temporary fixture');
  }
  rmSync(absolute, { recursive: true });
});

function project(name: string, strict: boolean, source = 'export const value: number = 7;') {
  const directory = join(fixtureRoot, 'packages', name);
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict, target: 'ES2020', module: 'ESNext', skipLibCheck: true }, include: ['src/**/*.ts'],
  }));
  const file = join(directory, 'src', name + '.ts');
  writeFileSync(file, source);
  return { file, source };
}
function typed(input: { file: string; source: string }, projects: string[], ignored?: string[]) {
  return parseForESLint(input.source, {
    filePath: input.file, tsconfigRootDir: fixtureRoot, project: projects, sourceType: 'module', ecmaVersion: 2022,
    // These cases switch project configuration in one session, rather than CLI autofix.
    disallowAutomaticSingleRunInference: true,
    range: true, loc: true, projectFolderIgnoreList: ignored,
  });
}

describe('TypeScript ESLint consumers: AST, scopes, project globs and unchanged rules', () => {
  it('parses exported TS types and preserves token ranges and module scopes', () => {
    const source = 'export type Outcome<T> = { value: T } | { error: string }; export const count: number = 7;';
    const result = parseForESLint(source, { filePath: join(fixtureRoot, 'sample.ts'), sourceType: 'module', range: true, loc: true });
    expect(result.ast.body).toHaveLength(2);
    expect(result.ast.body.map(node => node.type)).toEqual(['ExportNamedDeclaration', 'ExportNamedDeclaration']);
    expect(result.ast.tokens?.find(token => token.value === 'Outcome')?.range).toEqual([12, 19]);
    expect(result.scopeManager?.scopes.find(scope => scope.type === 'module')?.variables.map(variable => variable.name))
      .toEqual(expect.arrayContaining(['Outcome', 'count']));
  });
  it('parses JSX with a typed prop without treating it as TS type assertion syntax', () => {
    const result = parseForESLint('export const Header = ({ caption }: { caption: string }) => <h1>{caption}</h1>;', {
      filePath: join(fixtureRoot, 'Header.tsx'), sourceType: 'module', ecmaFeatures: { jsx: true }, range: true,
    });
    expect(result.ast.tokens?.some(token => token.value === 'h1')).toBe(true);
    expect(result.scopeManager?.scopes.some(scope => scope.variables.some(variable => variable.name === 'caption'))).toBe(true);
  });
  it.each([['bad.ts', 'const value: = 1;'], ['bad.tsx', 'export const View = () => <div><;']])('rejects malformed %s input', (name, source) => {
    expect(() => parseForESLint(source, { filePath: join(fixtureRoot, name), sourceType: 'module', ecmaFeatures: { jsx: true } })).toThrow();
  });
  it('resolves multiple project globs to the correct compiler options and source files', () => {
    const north = project('north', true), south = project('south', false);
    for (const [input, expectedStrict] of [[north, true], [south, false]] as const) {
      const result = typed(input, ['packages/*/tsconfig.json']);
      const program = result.services.program;
      expect(program).not.toBeNull();
      if (!program) throw new Error('Typed parser did not return a program');
      expect(program.getSourceFile(input.file)).toBeDefined();
      expect(program.getCompilerOptions().strict).toBe(expectedStrict);
      expect(program.getSemanticDiagnostics(program.getSourceFile(input.file))).toEqual([]);
    }
  });
  it('honors glob exclusions instead of reusing a previously cached excluded project', () => {
    const north = project('north', true), south = project('south', false);
    expect(typed(south, ['packages/*/tsconfig.json']).services.program?.getSourceFile(south.file)).toBeDefined();
    const projects = ['packages/*/tsconfig.json'], ignored = ['**/node_modules/**', '**/south/**'];
    expect(typed(north, projects, ignored).services.program?.getSourceFile(north.file)).toBeDefined();
    expect(() => typed(south, projects, ignored)).toThrow();
  });
  it('honors exclusions for a fixed CI single-run project configuration', () => {
    const previous = process.env.TSESTREE_SINGLE_RUN;
    try {
      process.env.TSESTREE_SINGLE_RUN = 'true';
      const north = project('north', true), south = project('south', false);
      const projects = ['packages/*/tsconfig.json'], ignored = ['**/node_modules/**', '**/south/**'];
      const program = typed(north, projects, ignored).services.program;
      expect(program?.getSourceFile(north.file)).toBeDefined();
      expect(program?.getCompilerOptions().strict).toBe(true);
      expect(() => typed(south, projects, ignored)).toThrow();
    } finally {
      if (previous === undefined) delete process.env.TSESTREE_SINGLE_RUN;
      else process.env.TSESTREE_SINGLE_RUN = previous;
      clearCaches();
    }
  });
  it('selects the included source project even when its config is listed after another project', () => {
    const north = project('north', true); project('south', false);
    const result = typed(north, ['packages/south/tsconfig.json', 'packages/north/tsconfig.json']);
    expect(result.services.program?.getCompilerOptions().strict).toBe(true);
    expect(result.services.program?.getSourceFile(north.file)).toBeDefined();
  });
  it('preserves compiler diagnostics for valid syntax with a semantic type mismatch', () => {
    const input = project('north', true, "export const value: number = 'unexpected text';");
    const program = typed(input, ['packages/*/tsconfig.json']).services.program;
    expect(program).not.toBeNull();
    if (!program) throw new Error('Typed parser did not return a program');
    expect(program.getSemanticDiagnostics(program.getSourceFile(input.file)).some(diagnostic => diagnostic.code === 2322)).toBe(true);
  });
  it('uses the repository rules to keep unused variables as errors and explicit any as a warning', async () => {
    const eslint = new ESLint({ cwd: resolve(process.cwd()) });
    const [result] = await eslint.lintText('export const used: any = 1; const unused = 2;', { filePath: 'src/test/tooling-synthetic-input.ts' });
    expect(result.messages.some(message => message.ruleId === '@typescript-eslint/no-unused-vars' && message.severity === 2)).toBe(true);
    expect(result.messages.some(message => message.ruleId === '@typescript-eslint/no-explicit-any' && message.severity === 1)).toBe(true);
  });
});
