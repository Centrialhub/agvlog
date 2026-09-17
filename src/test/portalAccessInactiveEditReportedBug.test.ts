import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/TeamManagement.tsx', 'utf8');

describe('reported inactive portal access edit bug', () => {
  it('does not mutate active status while editing unrelated fields', () => {
    const dialog = source.slice(source.indexOf('function PortalAccessDialog'), source.indexOf('function InviteDialog'));
    const saveStart = dialog.indexOf('const save = async');
    const save = dialog.slice(saveStart, dialog.indexOf('return (', saveStart));
    const payload = save.slice(save.indexOf('const payload ='), save.indexOf('if (editing)'));
    const editingBranch = save.slice(save.indexOf('if (editing)'), save.indexOf('} else if (userId)'));
    const insertBranch = save.slice(save.indexOf('} else if (userId)'), save.indexOf('} else {', save.indexOf('} else if (userId)') + 1));

    expect(payload).not.toMatch(/\bactive\s*:/);
    expect(editingBranch).toContain('.update(payload)');
    expect(insertBranch).toContain('{ ...payload, active: true }');
  });
});
