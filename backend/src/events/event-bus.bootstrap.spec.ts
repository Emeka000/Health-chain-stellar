import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function getModuleFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...getModuleFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.module.ts')) files.push(fullPath);
  }
  return files;
}

describe('Event bus bootstrap', () => {
  it('initializes EventEmitterModule.forRoot only once in app modules', () => {
    const srcRoot = join(process.cwd(), 'src');
    const moduleFiles = getModuleFiles(srcRoot);
    const withForRoot = moduleFiles.filter((filePath) =>
      readFileSync(filePath, 'utf8').includes('EventEmitterModule.forRoot('),
    );

    expect(withForRoot.length).toBe(1);
    expect(withForRoot[0]?.endsWith(join('src', 'app.module.ts'))).toBe(true);
  });
});
