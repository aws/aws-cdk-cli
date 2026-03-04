import * as path from 'path';
import * as fs from 'fs-extra';
import { guessLanguage } from '../../lib/util/guess-language';

describe('guessLanguage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(__dirname, 'guess-lang-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  test('returns typescript when package.json has typescript dependency', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      dependencies: { typescript: '^5.0.0' },
    });
    expect(await guessLanguage(tmpDir)).toBe('typescript');
  });

  test('returns typescript when package.json has ts-node devDependency', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      devDependencies: { 'ts-node': '^10.0.0' },
    });
    expect(await guessLanguage(tmpDir)).toBe('typescript');
  });

  test('returns javascript when package.json has no typescript indicators', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      dependencies: { 'aws-cdk-lib': '^2.0.0' },
    });
    expect(await guessLanguage(tmpDir)).toBe('javascript');
  });

  test('returns python for requirements.txt', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), '');
    expect(await guessLanguage(tmpDir)).toBe('python');
  });

  test('returns python for pyproject.toml', async () => {
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '');
    expect(await guessLanguage(tmpDir)).toBe('python');
  });

  test('returns java for pom.xml', async () => {
    await fs.writeFile(path.join(tmpDir, 'pom.xml'), '');
    expect(await guessLanguage(tmpDir)).toBe('java');
  });

  test('returns dotnet for .csproj file', async () => {
    await fs.writeFile(path.join(tmpDir, 'MyApp.csproj'), '');
    expect(await guessLanguage(tmpDir)).toBe('dotnet');
  });

  test('returns go for go.mod', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), '');
    expect(await guessLanguage(tmpDir)).toBe('go');
  });

  test('returns undefined for unknown project', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '');
    expect(await guessLanguage(tmpDir)).toBeUndefined();
  });

  test('returns undefined for non-existent directory', async () => {
    expect(await guessLanguage('/nonexistent/path')).toBeUndefined();
  });
});
