// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('source-map-js');

describe('indexed source maps at the build/coverage consumer boundary', () => {
  it.each([0, 1_000_000, 1_000_000_000_000])('handles section offset %s within a bounded process', offset => {
    // Keep a vulnerable future regression out of the test worker's event loop.
    // The child has finite memory/time, uses only synthetic maps and does no I/O.
    const script = `
      const {SourceMapConsumer, SourceNode} = require(${JSON.stringify(modulePath)});
      const source = 'console.log(1);';
      try {
      const consumer = new SourceMapConsumer({version:3, sections:[{
        offset:{line:${offset},column:0},
        map:{version:3,sources:['input.js'],sourcesContent:[source],names:[],mappings:'AAAA'}
      }]});
      const node = SourceNode.fromStringWithSourceMap(source,consumer);
      const rendered = node.toStringWithSourceMap({file:'output.js'});
      const content = [];
      node.walkSourceContents((_file,sourceContent)=>content.push(sourceContent));
      process.stdout.write(JSON.stringify({code:rendered.code, content}));
      } catch (error) { process.stdout.write(JSON.stringify({error:error.message})); }
    `;
    const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', script], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    if (offset > 10_000_000) expect(JSON.parse(child.stdout)).toEqual({
      error: expect.stringMatching(/Section offset line/),
    });
    else expect(JSON.parse(child.stdout)).toEqual({ code: 'console.log(1);', content: ['console.log(1);'] });
  });
});
