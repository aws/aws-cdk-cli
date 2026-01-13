import type { EventType, TelemetrySchema } from '../../../../lib/cli/telemetry/schema';

// Helper function to create a test event
export function createTestEvent(eventType: EventType, config: Record<string, any> = {}): TelemetrySchema {
  return {
    identifiers: {
      cdkCliVersion: '1.0.0',
      telemetryVersion: '1.0.0',
      sessionId: 'test-session',
      eventId: `test-event-${eventType}`,
      installationId: 'test-installation',
      timestamp: new Date().toISOString(),
    },
    event: {
      state: 'SUCCEEDED',
      eventType,
      command: {
        path: ['test'],
        parameters: {},
        config,
      },
    },
    environment: {
      os: {
        platform: 'test',
        release: 'test',
      },
      ci: false,
      nodeVersion: process.version,
    },
    project: {},
    duration: {
      total: 0,
    },
  };
}
