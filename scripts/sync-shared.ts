import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src/domain');
const destination = join(root, 'supabase/functions/_shared/domain');

await rm(destination, { recursive: true, force: true });
await copyDomain(source, destination);

async function copyDomain(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx') ||
        entry.name === 'test-package.ts')
    ) {
      continue;
    }
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyDomain(sourcePath, destinationPath);
      continue;
    }
    const contents = await readFile(sourcePath, 'utf8');
    const denoContents = contents.replace(
      /(['"])(\.{1,2}\/[^'"]+)\1/g,
      (_match, quote: string, specifier: string) =>
        `${quote}${/\.[cm]?[jt]sx?$/.test(specifier) ? specifier : `${specifier}.ts`}${quote}`,
    );
    await writeFile(destinationPath, denoContents);
    console.log(relative(root, destinationPath));
  }
}
