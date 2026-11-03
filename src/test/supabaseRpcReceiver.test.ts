import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { assertBoundSupabaseRpc } from './helpers/assertBoundSupabaseRpc';

function hasDetachedRpc(source: string) {
  const ast = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let detached = false;
  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && node.getText(ast) === 'supabase.rpc') {
      let expression: ts.Node = node;
      while (ts.isAsExpression(expression.parent) || ts.isParenthesizedExpression(expression.parent)
        || ts.isSatisfiesExpression(expression.parent)) expression = expression.parent;
      const parent = expression.parent;
      const directCall = ts.isCallExpression(parent) && parent.expression === expression;
      const boundCall = ts.isPropertyAccessExpression(parent) && parent.name.text === 'bind'
        && ts.isCallExpression(parent.parent) && parent.parent.expression === parent
        && parent.parent.arguments[0]?.getText(ast) === 'supabase';
      if (!directCall && !boundCall && !ts.isTypeQueryNode(parent)) detached = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return detached;
}

describe('Supabase RPC clients', () => {
  it('never detaches rpc from its SDK client receiver', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(file => file && !file.includes('/test/'));

    const offenders = files.filter(file => {
      const source = readFileSync(file, 'utf8');
      if (source.includes('.bind(supabase)') && source.includes('supabase.rpc')) assertBoundSupabaseRpc(source);
      return hasDetachedRpc(source);
    });

    expect(offenders).toEqual([]);
  });

  it.each([
    ['supabase.rpc("name", {})', false],
    ['const rpc = supabase.rpc.bind(supabase)', false],
    ['const rpc = (supabase.rpc as unknown as Rpc).bind(supabase)', false],
    ['const rpc = supabase.rpc', true],
    ['const rpc = supabase.rpc as unknown as Rpc', true],
    ['const rpc = (supabase.rpc as unknown as Rpc).bind(otherClient)', true],
  ])('detects receiver safety in %s', (source, detached) => {
    expect(hasDetachedRpc(source)).toBe(detached);
  });
});
