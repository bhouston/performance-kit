import { cp, mkdir, rm } from 'node:fs/promises';
const destination = new URL('../packages/cli/viewer/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('../packages/viewer/dist/', import.meta.url), destination, { recursive: true });
