import { validateRegistry } from './lib/internalTodoRegistry.mjs';

const result = validateRegistry({ rootDirectory: process.cwd() });
if (result.errors.length > 0) {
  console.error('Internal TODO registry validation failed:');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Internal TODO registry valid: ${result.registryCount} IDs, ${result.markerCount} source marker paths.`);
}
