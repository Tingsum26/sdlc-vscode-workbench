import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SOURCE_ROOTS = (process.env.SDLC_SOURCE_ROOTS ?? 'src').split(',');
const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules', 'playwright-report', 'target', 'test-results']);
const CANONICAL_MARKER = /TODO\(INTERNAL\): (INTERNAL-(?:[A-Z0-9]+-)*\d{3})(?![A-Z0-9-])/g;
const ANY_MARKER = /TODO\(INTERNAL\):\s*([^\s`'"<]*)/g;
const VALID_ID = /^INTERNAL-(?:[A-Z0-9]+-)*\d{3}$/;
const ENTRY_FIELDS = new Set(['id', 'component', 'markerPaths', 'action', 'evidence', 'rollback']);
const TABLE_ID = /^\|\s*(INTERNAL-(?:[A-Z0-9]+-)*\d{3})\s*\|/;

function normalizedRelativePath(rootDirectory, filePath) {
  return relative(rootDirectory, filePath).replaceAll('\\', '/');
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readCanonicalMarkers(rootDirectory, errors) {
  const markers = new Map();
  let markerCount = 0;

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const sourcePath = normalizedRelativePath(rootDirectory, fullPath);
      const source = readFileSync(fullPath, 'utf8');
      for (const match of source.matchAll(ANY_MARKER)) {
        const value = match[1];
        if (!VALID_ID.test(value)) errors.push(`Malformed internal TODO marker: ${value || '<missing>'} (${sourcePath})`);
      }
      for (const match of source.matchAll(CANONICAL_MARKER)) {
        markerCount += 1;
        const id = match[1];
        const paths = markers.get(id) ?? new Set();
        paths.add(sourcePath);
        markers.set(id, paths);
      }
    }
  }

  for (const sourceRoot of SOURCE_ROOTS) {
    const fullPath = join(rootDirectory, sourceRoot);
    try {
      visit(fullPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const explicitTemplate = join(rootDirectory, 'docs/handoff/internal-agent-completion-report-template.md');
  try {
    const source = readFileSync(explicitTemplate, 'utf8');
    for (const match of source.matchAll(ANY_MARKER)) {
      const value = match[1];
      if (value !== 'INTERNAL-XXX' && !VALID_ID.test(value)) {
        errors.push(`Malformed internal TODO marker: ${value || '<missing>'} (docs/handoff/internal-agent-completion-report-template.md)`);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { markers, markerCount };
}

function readRegistry(registryPath, errors) {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    if (!Array.isArray(parsed.entries)) {
      errors.push('Registry JSON must contain an entries array.');
      return [];
    }
    return parsed.entries;
  } catch (error) {
    errors.push(`Cannot read registry JSON: ${error.message}`);
    return [];
  }
}

function readMarkdownIds(markdownPath, errors) {
  try {
    return readFileSync(markdownPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(TABLE_ID)?.[1])
      .filter(Boolean);
  } catch (error) {
    errors.push(`Cannot read Markdown registry: ${error.message}`);
    return [];
  }
}

function samePaths(left, right) {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

export function validateRegistry({ rootDirectory }) {
  const root = resolve(rootDirectory);
  const errors = [];
  const registryEntries = readRegistry(join(root, 'docs/handoff/internal-todo-registry.json'), errors);
  const markdownIdRows = readMarkdownIds(join(root, 'docs/handoff/INTERNAL_TODO.md'), errors);
  const markdownIds = new Set(markdownIdRows);
  const { markers: sourceMarkers, markerCount } = readCanonicalMarkers(root, errors);
  const registryById = new Map();

  for (const id of sorted(markdownIds)) {
    if (markdownIdRows.filter((rowId) => rowId === id).length > 1) {
      errors.push(`Duplicate Markdown registry ID: ${id}`);
    }
  }

  for (const entry of registryEntries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push('Registry entry must be an object.');
      continue;
    }
    const missingFields = ['id', 'component', 'markerPaths', 'action', 'evidence', 'rollback']
      .filter((field) => entry?.[field] === undefined || entry[field] === '' || (Array.isArray(entry[field]) && entry[field].length === 0));
    const id = entry?.id ?? '<missing id>';
    const unknownFields = Object.keys(entry).filter((field) => !ENTRY_FIELDS.has(field));
    if (unknownFields.length > 0) errors.push(`Registry entry ${id} has unknown fields: ${unknownFields.sort().join(', ')}`);
    if (missingFields.length > 0) {
      errors.push(`Registry entry ${id} is missing required fields: ${missingFields.join(', ')}`);
      continue;
    }
    if (typeof entry.id !== 'string' || !VALID_ID.test(entry.id)) {
      errors.push(`Registry entry ${id} has invalid id.`);
    }
    for (const field of ['component', 'action', 'evidence', 'rollback']) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        errors.push(`Registry entry ${id} has invalid ${field}.`);
      }
    }
    if (!Array.isArray(entry.markerPaths) || entry.markerPaths.some((path) => typeof path !== 'string' || path.length === 0)) {
      errors.push(`Registry entry ${id} has invalid markerPaths.`);
      continue;
    }
    if (entry.markerPaths.some((path) => path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)
        || path.split('/').some((segment) => segment === '..')
        || !SOURCE_ROOTS.some((sourceRoot) => path.startsWith(`${sourceRoot}/`)))) {
      errors.push(`Registry entry ${id} has invalid markerPaths.`);
      continue;
    }
    if (new Set(entry.markerPaths).size !== entry.markerPaths.length) {
      errors.push(`Registry entry ${id} has duplicate markerPaths.`);
    }
    if (typeof entry.id !== 'string' || !VALID_ID.test(entry.id)
        || unknownFields.length > 0 || new Set(entry.markerPaths).size !== entry.markerPaths.length
        || ['component', 'action', 'evidence', 'rollback'].some((field) => typeof entry[field] !== 'string' || entry[field].trim().length === 0)) {
      continue;
    }
    if (registryById.has(id)) {
      errors.push(`Duplicate registry ID: ${id}`);
      continue;
    }
    registryById.set(id, entry);
  }

  for (const [id, paths] of [...sourceMarkers.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!registryById.has(id)) {
      for (const path of sorted(paths)) errors.push(`Unregistered source marker: ${id} (${path})`);
    }
  }

  for (const [id, entry] of [...registryById.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const actualPaths = sorted(sourceMarkers.get(id) ?? []);
    if (actualPaths.length === 0) {
      errors.push(`Registry entry has no source marker: ${id}`);
      continue;
    }
    const expectedPaths = sorted(new Set(entry.markerPaths));
    if (!samePaths(expectedPaths, actualPaths)) {
      errors.push(`Marker paths do not match for ${id}: expected [${expectedPaths.join(', ')}], found [${actualPaths.join(', ')}]`);
    }
  }

  const registryIds = new Set(registryById.keys());
  const missingInMarkdown = sorted([...registryIds].filter((id) => !markdownIds.has(id)));
  const absentFromRegistry = sorted([...markdownIds].filter((id) => !registryIds.has(id)));
  if (missingInMarkdown.length > 0) errors.push(`Markdown is missing registry IDs: ${missingInMarkdown.join(', ')}`);
  if (absentFromRegistry.length > 0) errors.push(`Markdown has IDs absent from registry: ${absentFromRegistry.join(', ')}`);

  return {
    markerCount,
    registryCount: registryById.size,
    errors: sorted(errors)
  };
}
