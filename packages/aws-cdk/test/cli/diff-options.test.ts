import * as cdkToolkitModule from '../../lib/cli/cdk-toolkit';
import { exec } from '../../lib/cli/cli';

// Prevent actual toolkit operations
let diffSpy: jest.SpyInstance;
beforeEach(() => {
  diffSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'diff').mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('diff --method option', () => {
  test('defaults to method=auto', async () => {
    await exec(['diff', '--app', 'echo']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'auto' }));
  });

  test('--method=change-set', async () => {
    await exec(['diff', '--app', 'echo', '--method=change-set']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'change-set' }));
  });

  test('--method=template', async () => {
    await exec(['diff', '--app', 'echo', '--method=template']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'template' }));
  });

  test('deprecated --no-change-set maps to method=template', async () => {
    await exec(['diff', '--app', 'echo', '--no-change-set']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'template' }));
  });

  test('deprecated --change-set maps to method=auto', async () => {
    await exec(['diff', '--app', 'echo', '--change-set']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'auto' }));
  });

  test('--method takes precedence over deprecated --no-change-set', async () => {
    await exec(['diff', '--app', 'echo', '--method=change-set', '--no-change-set']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'change-set' }));
  });

  test('--template implies method=template', async () => {
    await exec(['diff', '--app', 'echo', '--template=/tmp/template.json']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'template' }));
  });
});

describe('diff --json-file option', () => {
  test('jsonFile defaults to unset', async () => {
    await exec(['diff', '--app', 'echo']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ jsonFile: undefined }));
  });

  test('--json-file is forwarded', async () => {
    await exec(['diff', '--app', 'echo', '--json-file=diff.json']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ jsonFile: 'diff.json' }));
  });

  test('--json-file does not swallow stack names', async () => {
    await exec(['diff', '--app', 'echo', '--json-file=diff.json', 'MyStack']);
    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({
      stackNames: ['MyStack'],
      jsonFile: 'diff.json',
    }));
  });
});
