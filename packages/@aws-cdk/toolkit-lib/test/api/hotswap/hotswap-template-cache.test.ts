import * as path from 'path';
import * as fs from 'fs-extra';
import type { NestedStackTemplates, Template } from '../../../lib/api/cloudformation';
import {
  existingHotswapCache,
  readHotswapTemplateCache,
  writeHotswapTemplateCache,
  invalidateHotswapTemplateCache,
} from '../../../lib/api/hotswap/hotswap-template-cache';

let assemblyDir: string;

beforeEach(async () => {
  assemblyDir = await fs.mkdtemp(path.join(__dirname, '.tmp-cache-'));
});

afterEach(async () => {
  await fs.remove(assemblyDir);
});

const STACK_NAME = 'MyStack';

function nestedStackResource(assetPath: string): any {
  return {
    Type: 'AWS::CloudFormation::Stack',
    Metadata: { 'aws:asset:path': assetPath },
  };
}

function writeNestedTemplateAsset(assetPath: string, template: Template) {
  const fullPath = path.join(assemblyDir, assetPath);
  fs.ensureDirSync(path.dirname(fullPath));
  fs.writeJsonSync(fullPath, template);
}

describe('hotswap-template-cache', () => {
  test('read and write root and nested stacks to hotswap cache file', async () => {
    const rootTemplate: Template = { Resources: { Nested: nestedStackResource('nested.template.json') } };
    const nestedDeployed: Template = { Resources: { Fn: { Type: 'AWS::Lambda::Function' } } };
    const nestedGenerated: Template = { Resources: { Fn: { Type: 'AWS::Lambda::Function', Properties: { Code: 'new' } } } };

    writeNestedTemplateAsset('nested.template.json', nestedGenerated);

    const nestedStacks: Record<string, NestedStackTemplates> = {
      Nested: {
        physicalName: 'MyStack-Nested-ABC',
        deployedTemplate: nestedDeployed,
        generatedTemplate: nestedGenerated,
        nestedStackTemplates: {},
      },
    };

    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate, nestedStacks);
    const result = await readHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate);

    expect(result).toBeDefined();
    expect(result!.deployedRootTemplate).toEqual(rootTemplate);
    expect(result!.nestedStacks.Nested.physicalName).toBe('MyStack-Nested-ABC');
    expect(result!.nestedStacks.Nested.generatedTemplate).toEqual(nestedGenerated);
  });

  test('read returns undefined when no cache exists', async () => {
    const result = await readHotswapTemplateCache(assemblyDir, 'NoSuchStack', {});
    expect(result).toBeUndefined();
  });

  test('nested generatedTemplate is read fresh from disk, not from cache', async () => {
    const rootTemplate: Template = { Resources: { Nested: nestedStackResource('nested.template.json') } };
    const originalGenerated: Template = { Resources: { Fn: { Type: 'AWS::Lambda::Function', Properties: { Code: 'v1' } } } };

    writeNestedTemplateAsset('nested.template.json', originalGenerated);

    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate, {
      Nested: {
        physicalName: 'phys',
        deployedTemplate: { Resources: {} },
        generatedTemplate: originalGenerated,
        nestedStackTemplates: {},
      },
    });

    // Modify the asset file on disk to simulate a new synthesis
    const updatedGenerated: Template = { Resources: { Fn: { Type: 'AWS::Lambda::Function', Properties: { Code: 'v2' } } } };
    writeNestedTemplateAsset('nested.template.json', updatedGenerated);

    const result = await readHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate);
    expect(result!.nestedStacks.Nested.generatedTemplate).toEqual(updatedGenerated);
  });

  test('cache stores generatedTemplate as the new deployedTemplate', async () => {
    const rootTemplate: Template = { Resources: {} };
    const deployed: Template = { Resources: { Old: { Type: 'AWS::SNS::Topic' } } };
    const generated: Template = { Resources: { New: { Type: 'AWS::SNS::Topic' } } };

    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate, {
      Nested: {
        physicalName: 'phys',
        deployedTemplate: deployed,
        generatedTemplate: generated,
        nestedStackTemplates: {},
      },
    });

    const cachedTemplate = await fs.readJson(path.join(assemblyDir, '.hotswap-cache', `${STACK_NAME}.json`));
    // The cached deployedTemplate should be what was the generatedTemplate at write time
    expect(cachedTemplate.nestedStacks.Nested.deployedTemplate).toEqual(generated);
  });

  test('non-CloudFormation::Stack resources are skipped during hydration', async () => {
    const nestedAsset = 'nested.template.json';
    const nestedGenerated: Template = { Resources: { SomeFunc: { Type: 'AWS::Lambda::Function' } } };
    writeNestedTemplateAsset(nestedAsset, nestedGenerated);

    const rootTemplate: Template = {
      Resources: {
        Lambda: { Type: 'AWS::Lambda::Function', Properties: { Code: 'x' } },
        Nested: nestedStackResource(nestedAsset),
      },
    };

    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate, {
      Nested: {
        physicalName: 'phys',
        deployedTemplate: {},
        generatedTemplate: nestedGenerated,
        nestedStackTemplates: {},
      },
    });

    const result = await readHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate);
    expect(Object.keys(result!.nestedStacks)).toEqual(['Nested']);
  });

  test('deeply nested stacks are hydrated recursively', async () => {
    const level2Asset = 'level2.template.json';
    const level2Template: Template = { Resources: { Deep: { Type: 'AWS::SQS::Queue' } } };
    writeNestedTemplateAsset(level2Asset, level2Template);

    const level1Asset = 'level1.template.json';
    const level1Template: Template = { Resources: { Level2: nestedStackResource(level2Asset), ResourceLogs: { Type: 'AWS::Logs::LogGroup' } } };
    writeNestedTemplateAsset(level1Asset, level1Template);

    const rootTemplate: Template = { Resources: { Level1: nestedStackResource(level1Asset), SomeFunc: { Type: 'AWS::Lambda::Function' } } };

    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate, {
      Level1: {
        physicalName: 'phys-l1',
        deployedTemplate: {},
        generatedTemplate: level1Template,
        nestedStackTemplates: {
          Level2: {
            physicalName: 'phys-l2',
            deployedTemplate: {},
            generatedTemplate: level2Template,
            nestedStackTemplates: {},
          },
        },
      },
    });

    const result = await readHotswapTemplateCache(assemblyDir, STACK_NAME, rootTemplate);
    const level1 = result!.nestedStacks.Level1;
    expect(level1.generatedTemplate).toEqual(level1Template);
    expect(level1.physicalName).toBe('phys-l1');

    const level2 = level1.nestedStackTemplates.Level2;
    expect(level2.generatedTemplate).toEqual(level2Template);
    expect(level2.physicalName).toBe('phys-l2');
  });

  test('existingHotswapCache returns true when cache file exists', async () => {
    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, { Resources: { SomeFunc: { Type: 'AWS::Lambda::Function' } } }, {});
    expect(await existingHotswapCache(assemblyDir, STACK_NAME)).toBe(true);
  });

  test('existingHotswapCache returns false when no cache file exists', async () => {
    expect(await existingHotswapCache(assemblyDir, STACK_NAME)).toBe(false);
  });

  test('invalidateHotswapTemplateCache removes the cache file', async () => {
    await writeHotswapTemplateCache(assemblyDir, STACK_NAME, { Resources: { SomeFunc: { Type: 'AWS::Lambda::Function' } } }, {});
    await invalidateHotswapTemplateCache(assemblyDir, STACK_NAME);
    expect(await existingHotswapCache(assemblyDir, STACK_NAME)).toBe(false);
  });

  test('invalidateHotswapTemplateCache is a no-op when cache does not exist', async () => {
    // Should not throw
    expect(await invalidateHotswapTemplateCache(assemblyDir, 'NonExistent')).toBe(undefined);
  });
});
