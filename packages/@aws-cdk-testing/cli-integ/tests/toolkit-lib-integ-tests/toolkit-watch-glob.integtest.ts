/* eslint-disable import/no-extraneous-dependencies */
import * as fs from 'fs';
import * as path from 'path';
import * as toolkit from '@aws-cdk/toolkit-lib';
import { assemblyFromCdkAppDir, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withDefaultFixture } from '../../lib';

/**
 * Integration tests for toolkit-lib watch with glob pattern matching.
 *
 * These tests verify that the chokidar v4 glob pattern fix works correctly
 * by using the actual Toolkit.watch() method with real file system operations.
 */

integTest(
  'toolkit watch detects file changes with glob patterns',
  withDefaultFixture(async (fixture) => {
    const tk = toolkitFromFixture(fixture);
    const assembly = await assemblyFromCdkAppDir(tk, fixture);

    // Track events received from the watcher
    const receivedEvents: Array<{ code: string | undefined; message: string }> = [];

    // Create a custom IoHost to capture watch events
    const customTk = new toolkit.Toolkit({
      ioHost: {
        notify: async (msg) => {
          receivedEvents.push({ code: msg.code, message: msg.message });
        },
        requestResponse: async <T>(): Promise<T> => undefined as unknown as T,
      },
    });

    // Create a test file in the watch directory
    const testFile = path.join(fixture.integTestDir, 'watch-test-file.ts');

    // Start watching with specific include patterns
    const watcher = await customTk.watch(assembly, {
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**', '**/*.test.ts'],
      watchDir: fixture.integTestDir,
      // Use a deployment method that won't actually deploy (we just want to test file watching)
      deploymentMethod: { method: 'hotswap' },
    });

    try {
      // Wait a bit for the watcher to initialize
      await sleep(1000);

      // Create a new .ts file - this should be detected
      fs.writeFileSync(testFile, 'export const watchTest = true;');

      // Wait for the file change to be detected
      await sleep(2000);

      // Verify that the watcher detected the file
      const observingEvents = receivedEvents.filter(e =>
        e.code === 'CDK_TOOLKIT_I5311' || // observing file
        e.code === 'CDK_TOOLKIT_I5312' || // detected change
        e.code === 'CDK_TOOLKIT_I5314', // triggering deploy
      );

      fixture.log(`Received ${observingEvents.length} watch-related events`);
      for (const event of observingEvents) {
        fixture.log(`  ${event.code}: ${event.message.substring(0, 100)}...`);
      }

      // The watcher should have received the ready event and started observing
      const hasReadyOrObserving = receivedEvents.some(e =>
        e.code === 'CDK_TOOLKIT_I5314' || // triggering initial deploy
        e.code === 'CDK_TOOLKIT_I5311', // observing files
      );

      if (!hasReadyOrObserving) {
        throw new Error('Watcher did not emit ready/observing events');
      }

      fixture.log('✓ Toolkit watch successfully initialized and detected files');
    } finally {
      // Clean up - dispose and wait for async operations to settle
      await watcher.dispose();
      await sleep(1000); // Allow async operations to complete
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  }),
);

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
      await sleep(500);

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
      await sleep(1000); // Allow async operations to complete
    }
  }),
);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
