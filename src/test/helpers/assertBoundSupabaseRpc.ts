import ts from 'typescript';
import { expect } from 'vitest';

/** Exercise the actual binding expression after erasing its TypeScript casts. */
export function assertBoundSupabaseRpc(source: string) {
  const ast = ts.createSourceFile('rpc-client.ts', source, ts.ScriptTarget.Latest, true);
  const bindings: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'bind'
      && node.arguments[0]?.getText(ast) === 'supabase'
      && node.expression.expression.getText(ast).includes('supabase.rpc')) bindings.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(bindings.length).toBeGreaterThan(0);
  for (const binding of bindings) {
    const args = { tenant: 'synthetic-tenant' };
    const client = {
      rpc(this: unknown, name: string, values: unknown) {
        expect(this).toBe(client);
        expect(name).toBe('synthetic_rpc');
        expect(values).toBe(args);
        return values;
      },
    };
    const expression = ts.transpileModule(binding.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText.trim().replace(/;$/, '');
    const bound = new Function('supabase', `return ${expression}`)(client) as typeof client.rpc;
    expect(bound('synthetic_rpc', args)).toBe(args);
  }
  expect(source).not.toMatch(/const rpc\s*=\s*supabase\.rpc\s+as/);
}
