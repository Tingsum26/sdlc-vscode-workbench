import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateRegistry } from '../lib/internalTodoRegistry.mjs';

const registryEntry = (id, markerPaths = ['src/sample/Example.java']) => ({
  id,
  component: 'sample',
  markerPaths,
  action: 'Complete the internal replacement.',
  evidence: 'Sanitized test result.',
  rollback: 'Restore the fake adapter.'
});

async function fixture({ entries, markdownIds, markers, templateMarkers = [] }) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'internal-todo-registry-'));
  await mkdir(join(rootDirectory, 'src/sample'), { recursive: true });
  await mkdir(join(rootDirectory, 'docs/handoff'), { recursive: true });
  await writeFile(join(rootDirectory, 'src/sample/Example.java'), markers.join('\n'));
  await writeFile(
    join(rootDirectory, 'docs/handoff/internal-todo-registry.json'),
    JSON.stringify({ entries }, null, 2)
  );
  if (templateMarkers.length > 0) {
    await writeFile(join(rootDirectory, 'docs/handoff/internal-agent-completion-report-template.md'), templateMarkers.join('\n'));
  }
  await writeFile(
    join(rootDirectory, 'docs/handoff/INTERNAL_TODO.md'),
    ['| ID | Component |', '|---|---|', ...markdownIds.map((id) => `| ${id} | sample |`)].join('\n')
  );
  return rootDirectory;
}

async function withFixture(input, assertion) {
  const rootDirectory = await fixture(input);
  try {
    await assertion(rootDirectory);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

test('validates the checked-in registry against its canonical source markers', () => {
  const result = validateRegistry({ rootDirectory: process.cwd() });

  assert.equal(result.errors.length, 0, result.errors.join('\n'));
  assert.equal(result.registryCount, 1);
  assert.equal(result.markerCount, 1);
});

test('reports a canonical source marker that is not registered', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid', '// TODO(INTERNAL): INTERNAL-OTHER-001 missing']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.deepEqual(result.errors, [
        'Unregistered source marker: INTERNAL-OTHER-001 (src/sample/Example.java)'
      ]);
    }
  );
});

test('reports a JSON entry with no canonical source marker', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001'), registryEntry('INTERNAL-MISSING-001')],
      markdownIds: ['INTERNAL-SAMPLE-001', 'INTERNAL-MISSING-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.includes('Registry entry has no source marker: INTERNAL-MISSING-001'));
    }
  );
});

test('reports a marker path mismatch', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001', ['src/sample/Wrong.java'])],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.includes(
        'Marker paths do not match for INTERNAL-SAMPLE-001: expected [src/sample/Wrong.java], found [src/sample/Example.java]'
      ));
    }
  );
});

test('reports a Markdown and JSON ID mismatch', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-DOCUMENTED-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.includes('Markdown is missing registry IDs: INTERNAL-SAMPLE-001'));
      assert.ok(result.errors.includes('Markdown has IDs absent from registry: INTERNAL-DOCUMENTED-001'));
    }
  );
});

test('reports duplicate IDs in the Markdown registry table', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-SAMPLE-001', 'INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.deepEqual(result.errors, ['Duplicate Markdown registry ID: INTERNAL-SAMPLE-001']);
    }
  );
});

test('rejects a template-shaped placeholder outside the explicit template file', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid', '// TODO(INTERNAL): INTERNAL-XXX placeholder']
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.some((error) => error.includes('Malformed internal TODO marker')));
      assert.equal(result.markerCount, 1);
    }
  );
});

test('rejects wrong registry field types, invalid IDs, and unsafe marker paths', async () => {
  await withFixture(
    {
      entries: [{ ...registryEntry('bad-id'), component: 7, markerPaths: ['../outside.java'], action: 7, evidence: {}, rollback: false }],
      markdownIds: [],
      markers: ['// no canonical marker'],
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.some((error) => error.includes('invalid id')));
      assert.ok(result.errors.some((error) => error.includes('component')));
      assert.ok(result.errors.some((error) => error.includes('markerPaths')));
      assert.ok(result.errors.some((error) => error.includes('action')));
    }
  );
});

test('reports malformed internal markers instead of silently ignoring them', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: [
        '// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid',
        '// TODO(INTERNAL): internal-bad-1 malformed',
        '// TODO(INTERNAL): INTERNAL-BAD-XYZ malformed',
      ],
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.some((error) => error.includes('Malformed internal TODO marker')));
    }
  );
});

test('allows the placeholder only in the explicit completion-report template', async () => {
  await withFixture(
    {
      entries: [registryEntry('INTERNAL-SAMPLE-001')],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid'],
      templateMarkers: ['TODO(INTERNAL): INTERNAL-XXX placeholder row'],
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.deepEqual(result.errors, []);
    }
  );
});

test('rejects unknown entry fields and duplicate marker paths', async () => {
  await withFixture(
    {
      entries: [{ ...registryEntry('INTERNAL-SAMPLE-001', ['src/sample/Example.java', 'src/sample/Example.java']), extra: true }],
      markdownIds: ['INTERNAL-SAMPLE-001'],
      markers: ['// TODO(INTERNAL): INTERNAL-SAMPLE-001 valid'],
    },
    async (rootDirectory) => {
      const result = validateRegistry({ rootDirectory });
      assert.ok(result.errors.some((error) => error.includes('unknown fields')));
      assert.ok(result.errors.some((error) => error.includes('duplicate markerPaths')));
    }
  );
});
