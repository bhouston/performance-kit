import { mkdir, writeFile } from 'node:fs/promises';
import { schemas } from '../packages/schema/dist/index.js';
const directory = new URL('../packages/schema/schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  await writeFile(
    new URL(`${name}.schema.json`, directory),
    `${JSON.stringify({ ...schema, $id: schema.$id ?? `https://bhouston.github.io/performance-kit/schema/v1/${name}.schema.json` }, null, 2)}\n`,
  );
}
