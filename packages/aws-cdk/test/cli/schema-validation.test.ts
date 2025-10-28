/* eslint-disable import/order */
import * as fs from 'fs-extra';
import * as path from 'path';
import { Configuration, PROJECT_CONFIG } from '../../lib/cli/user-configuration';
import { cdkConfigSchema } from '../../lib/schema';
import { TestIoHost } from '../_helpers/io-host';

jest.mock('fs-extra');
const mockedFs = jest.mocked(fs, { shallow: true });

describe('Schema Validation', () => {
  let ioHost: TestIoHost;
  let ioHelper: any;

  function mockConfig(config: any) {
    const GIVEN_CONFIG: Map<string, any> = new Map([[PROJECT_CONFIG, config]]);
    mockedFs.pathExists.mockImplementation(path => GIVEN_CONFIG.has(path));
    mockedFs.readJSON.mockImplementation(path => GIVEN_CONFIG.get(path));
  }

  beforeEach(() => {
    ioHost = new TestIoHost();
    ioHelper = ioHost.asHelper();
    jest.clearAllMocks();
  });

  describe('Schema Export and Structure', () => {
    test('schema is properly exported and has valid JSON Schema structure', () => {
      expect(cdkConfigSchema).toBeDefined();
      expect(typeof cdkConfigSchema).toBe('object');
      expect(cdkConfigSchema).toHaveProperty('$schema');
      expect(cdkConfigSchema).toHaveProperty('type', 'object');
      expect(cdkConfigSchema).toHaveProperty('properties');
      expect(typeof cdkConfigSchema.properties).toBe('object');
    });

    test('schema allows additional properties', () => {
      expect(cdkConfigSchema.additionalProperties).toBe(true);
    });

    test('schema has required metadata fields', () => {
      expect(cdkConfigSchema).toHaveProperty('title');
      expect(cdkConfigSchema).toHaveProperty('description');
      expect(typeof cdkConfigSchema.title).toBe('string');
      expect(typeof cdkConfigSchema.description).toBe('string');
    });
  });

  describe('Configuration Loading', () => {
    test('loads empty configuration without errors', async () => {
      mockConfig({});

      const config = await Configuration.fromArgsAndFiles(ioHelper);

      expect(config).toBeDefined();
      expect(ioHost.notifySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error' }),
      );
    });

    test('loads configuration and preserves all provided values', async () => {
      const testConfig = {
        app: 'test-app',
        output: 'test-output',
        customProperty: 'custom-value',
      };
      mockConfig(testConfig);

      const config = await Configuration.fromArgsAndFiles(ioHelper);

      expect(config.settings.get(['app'])).toBe('test-app');
      expect(config.settings.get(['output'])).toBe('test-output');
      expect(config.settings.get(['customProperty'])).toBe('custom-value');
    });

    test('handles malformed JSON gracefully', async () => {
      mockedFs.pathExists.mockImplementation(() => true);
      mockedFs.readJSON.mockImplementation(() => {
        throw new Error('Unexpected token in JSON');
      });

      await expect(Configuration.fromArgsAndFiles(ioHelper)).rejects.toThrow();
    });
  });

  describe('Validation Behavior', () => {
    test('preserves unknown properties but generates warnings', async () => {
      const configWithUnknownProps = {
        app: 'valid-app',
        unknownProperty: 'some-value',
        anotherUnknown: 123,
      };
      mockConfig(configWithUnknownProps);

      const config = await Configuration.fromArgsAndFiles(ioHelper);

      expect(config.settings.get(['app'])).toBe('valid-app');
      expect(config.settings.get(['unknownProperty'])).toBe('some-value');
      expect(config.settings.get(['anotherUnknown'])).toBe(123);

      // Should warn about unknown properties
      expect(ioHost.notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('Unknown property'),
        }),
      );
    });

    test('preserves invalid property types but generates warnings', async () => {
      const configWithInvalidTypes = {
        debug: 'true', // Should be boolean
        output: 42, // Should be string
        versionReporting: 'false', // Should be boolean
      };
      mockConfig(configWithInvalidTypes);

      const config = await Configuration.fromArgsAndFiles(ioHelper);

      // Values should be preserved as-is
      expect(config.settings.get(['debug'])).toBe('true');
      expect(config.settings.get(['output'])).toBe(42);
      expect(config.settings.get(['versionReporting'])).toBe('false');

      // Should warn about type mismatches
      expect(ioHost.notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringMatching(/should be.*got/),
        }),
      );
    });

    test('does not warn for valid configurations', async () => {
      const validConfig = {
        app: 'npx ts-node bin/app.ts',
        debug: true,
        versionReporting: false,
        output: 'cdk.out',
        context: {
          'feature-flag': true,
        },
      };
      mockConfig(validConfig);

      
      await Configuration.fromArgsAndFiles(ioHelper);

      
      expect(ioHost.notifySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn' }),
      );
    });
  });

  describe('Real Configuration Files', () => {
    // Test with actual configuration files from the test directory
    const testConfigsDir = path.resolve(__dirname, '../../../test-cdk-app');

    test('validates against valid extended configuration', async () => {
      // GIVEN
      const validExtendedConfig = {
        app: 'npx ts-node --prefer-ts-exts bin/app.ts',
        build: 'npm run build',
        requireApproval: 'broadening',
        debug: true,
        versionReporting: false,
        pathMetadata: true,
        assetMetadata: true,
        staging: true,
        output: 'cdk.out',
        profile: 'default',
        toolkitStackName: 'CDKToolkit',
        rollback: true,
        watch: {
          include: ['**'],
          exclude: ['node_modules'],
        },
        context: {
          '@aws-cdk/core:newStyleStackSynthesis': true,
        },
      };
      mockConfig(validExtendedConfig);

      
      const config = await Configuration.fromArgsAndFiles(ioHelper);

      
      expect(config).toBeDefined();
      expect(ioHost.notifySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn' }),
      );
    });

    test('handles configuration with validation errors appropriately', async () => {
      // GIVEN
      const configWithErrors = {
        app: 'npx ts-node --prefer-ts-exts bin/app.ts',
        debug: 'true', // Should be boolean
        versionReporting: 'false', // Should be boolean
        requireApproval: 'always', // Invalid enum value
        unknownProperty: 'this should trigger a warning',
        anotherUnknown: 123,
        output: 42, // Should be string
        context: {
          '@aws-cdk/core:enableStackNameDuplicates': 'yes',
        },
      };
      mockConfig(configWithErrors);

      
      const config = await Configuration.fromArgsAndFiles(ioHelper);

      
      // Configuration should still load
      expect(config).toBeDefined();
      expect(config.settings.get(['app'])).toBe('npx ts-node --prefer-ts-exts bin/app.ts');

      // Should preserve invalid values
      expect(config.settings.get(['debug'])).toBe('true');
      expect(config.settings.get(['versionReporting'])).toBe('false');
      expect(config.settings.get(['unknownProperty'])).toBe('this should trigger a warning');

      // Should generate warnings
      expect(ioHost.notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('Unknown property'),
        }),
      );
    });

    test('validates basic configuration structure', async () => {
      // GIVEN
      const basicConfig = {
        app: 'npx ts-node --prefer-ts-exts bin/app.ts',
        watch: {
          include: ['**'],
          exclude: [
            'README.md',
            'cdk*.json',
            '**/*.d.ts',
            '**/*.js',
            'tsconfig.json',
            'package*.json',
            'yarn.lock',
            'node_modules',
            'test',
          ],
        },
        context: {
          '@aws-cdk/aws-lambda:recognizeLayerVersion': true,
          '@aws-cdk/core:checkSecretUsage': true,
          '@aws-cdk/core:target-partitions': ['aws', 'aws-cn'],
        },
      };
      mockConfig(basicConfig);

      
      const config = await Configuration.fromArgsAndFiles(ioHelper);

      
      expect(config).toBeDefined();
      expect(config.settings.get(['app'])).toBe('npx ts-node --prefer-ts-exts bin/app.ts');
      expect(config.settings.get(['watch'])).toEqual(basicConfig.watch);
      expect(config.settings.get(['context'])).toEqual(basicConfig.context);

      // Should not generate warnings for valid configuration
      expect(ioHost.notifySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn' }),
      );
    });
  });

  describe('Schema Validation Integration', () => {
    test('validation system correctly identifies schema violations', async () => {
      // GIVEN - Mix of valid and invalid properties
      const mixedConfig = {
        // Valid properties
        app: 'valid-command',
        debug: true,
        
        // Invalid types
        output: 123,
        versionReporting: 'not-a-boolean',
        
        // Unknown properties
        customField: 'value',
        numericField: 42,
      };
      mockConfig(mixedConfig);

      
      const config = await Configuration.fromArgsAndFiles(ioHelper);

      
      // All values should be preserved
      expect(config.settings.get(['app'])).toBe('valid-command');
      expect(config.settings.get(['debug'])).toBe(true);
      expect(config.settings.get(['output'])).toBe(123);
      expect(config.settings.get(['customField'])).toBe('value');

      // Should have generated warnings for violations
      const warnCalls = ioHost.notifySpy.mock.calls.filter(
        call => call[0].level === 'warn'
      );
      expect(warnCalls.length).toBeGreaterThan(0);
    });

    test('validation respects schema additionalProperties setting', async () => {
      // GIVEN
      const configWithAdditionalProps = {
        app: 'test-app',
        customProperty: 'should-be-allowed',
        userDefinedField: { nested: 'object' },
      };
      mockConfig(configWithAdditionalProps);

      
      const config = await Configuration.fromArgsAndFiles(ioHelper);

      
      // Additional properties should be preserved (schema allows them)
      expect(config.settings.get(['customProperty'])).toBe('should-be-allowed');
      expect(config.settings.get(['userDefinedField'])).toEqual({ nested: 'object' });

      // Should warn about unknown properties but still preserve them
      expect(ioHost.notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('Unknown property'),
        }),
      );
    });
  });
});
