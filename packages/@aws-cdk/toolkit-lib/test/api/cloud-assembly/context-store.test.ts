import type { IContextStore } from '../../../lib';
import { CdkAppMultiContext, FileContext, MemoryContext } from '../../../lib';
import { TRANSIENT_CONTEXT_KEY } from '../../../lib/api';
import { autoCleanOutDir } from '../../_helpers';

type StoreFactory = (tmpDir: string) => IContextStore;

function memoryContext() {
  return new MemoryContext();
}

function fileContext(tmpDir: string) {
  return new FileContext(`${tmpDir}/file.json`);
}

function cdkAppMultiContext(tmpDir: string) {
  return new CdkAppMultiContext(tmpDir);
}

test.each([
  memoryContext,
  fileContext,
  cdkAppMultiContext,
])('%p provider does not persist transient errors', async (factory) => {
  // GIVEN
  await using tmpDir = autoCleanOutDir();
  const store1 = factory(tmpDir.dir);

  // WHEN
  await store1.update({
    'do-not-store': {
      [TRANSIENT_CONTEXT_KEY]: true,
      message: 'Something whent wrong',
    },
  });
  const store2 = factory(tmpDir.dir);
  const contents = await store2.read();

  // THEN
  expect(Object.keys(contents)).not.toContain('do-not-store');
});

test.each([
  fileContext,
  cdkAppMultiContext,
])('%p provider can retrieve persisted data', async (storeFactory: StoreFactory) => {
  // GIVEN
  await using tmpDir = autoCleanOutDir();
  const store1 = storeFactory(tmpDir.dir);

  // WHEN
  await store1.update({
    'some-key': 'some-value',
  });
  const store2 = storeFactory(tmpDir.dir);
  const contents = await store2.read();

  // THEN
  expect(contents['some-key']).toEqual('some-value');
});
