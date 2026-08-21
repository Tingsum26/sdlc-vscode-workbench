import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/verify-internal-todos.yml', import.meta.url);

test('GitHub Actions workflow uses least privilege and immutable action revisions', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow, /uses:\s*[^\s]+@v\d+/);
  const uses = [...workflow.matchAll(/uses:\s*[^@\s]+@([a-f0-9]{40})/g)];
  assert.equal(uses.length, 3);
});
