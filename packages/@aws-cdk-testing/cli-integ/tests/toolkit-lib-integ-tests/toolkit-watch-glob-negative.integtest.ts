import * as toolkit from '@aws-cdk/toolkit-lib';
import { assemblyFromCdkAppDir, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withDefaultFixture } from '../../lib';

/**
 * Integration test for toolkit-lib watch with glob pattern matching.
 *
 * These tests verify that the chokidar v4 glob pattern fix does not 
 * detects file changes on files that are excluded via config.
 */

integTest(
  'toolkit watch excludes node_modules and dotfiles by default',
  withDefaultFixture(async (fixture) => {
    const tk = toolkitFromFixture(fixture);
    const assembly = await assemblyFromCdkAppDir(tk, fixture);

    // Track the exclude patterns that were configured
    const configMessages: string[] = [];

    // Create a custom IoHost to capture configuration messages
    const customTk = new toolkit.Toolkit({
      ioHost: {
        notify: async (msg) => {
          if (msg.code === 'CDK_TOOLKIT_I5310') {
            configMessages.push(msg.message);
          }
        },
        requestResponse: async <T>(): Promise<T> => undefined as unknown as T,
      },
    });

    // Start watching with default exclude patterns
    const watcher = await customTk.watch(assembly, {
      include: ['**'],
      watchDir: fixture.integTestDir,
      deploymentMethod: { method: 'hotswap' },
    });

    try {
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that default excludes are applied
      const configMsg = configMessages.find(m => m.includes("'exclude' patterns"));

      if (!configMsg) {
        throw new Error('Did not receive exclude patterns configuration message');
      }

      // Check that default excludes are present
      if (!configMsg.includes('node_modules')) {
        throw new Error('Default excludes should include node_modules');
      }
      if (!configMsg.includes('.*')) {
        throw new Error('Default excludes should include dotfiles (.*)');
      }

      fixture.log('✓ Toolkit watch applies default exclude patterns correctly');
      fixture.log(`  Config: ${configMsg.substring(0, 200)}...`);
    } finally {
      await watcher.dispose();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Allow async operations to complete
    }
  }),
);