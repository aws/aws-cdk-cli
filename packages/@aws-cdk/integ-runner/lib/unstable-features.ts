import * as logger from './logger';

/**
 * Status of an unstable feature
 */
export enum FeatureStatus {
  /** Feature is actively supported and can be used */
  SUPPORTED = 'supported',
  /** Feature is deprecated but still functional - warns user */
  DEPRECATED = 'deprecated',
  /** Feature has been removed - warns user and ignores */
  REMOVED = 'removed',
}

/**
 * Definition of an unstable feature
 */
export interface UnstableFeature {
  /** Current status of the feature */
  readonly status: FeatureStatus;
  /** Warning message to display when requested feature is deprecated */
  readonly deprecationMessage: string;
  /** Message to display for requested features that are removed */
  readonly removalMessage: string;
}

/**
 * Registry of all unstable features
 */
export const UNSTABLE_FEATURES: Record<string, UnstableFeature> = {
  'deprecated-cli-engine': {
    status: FeatureStatus.REMOVED,
    deprecationMessage: 'You have opted-in to use the deprecated CLI engine which is scheduled to be removed in January 2026. If you have encountered blockers while using the new default engine, please let us know by opening an issue: https://github.com/aws/aws-cdk-cli/issues/new/choose\n\nTo use the new default engine, remove the `--unstable=deprecated-cli-engine` option.',
    removalMessage: 'The CLI engine has been removed. The toolkit-lib engine is now the only supported engine. Please remove this flag.',
  },
  'toolkit-lib-engine': {
    status: FeatureStatus.REMOVED,
    deprecationMessage: 'The toolkit-lib engine is now the default engine. This flag can be safely removed. You may choose to temporarily revert to the old engine by adding the `--unstable=deprecated-cli-engine` option.',
    removalMessage: 'The toolkit-lib engine is now the default and only engine. This flag can be safely removed.',
  },
};

/**
 * Process unstable feature flags and emit appropriate warnings
 *
 * @param unstableFeatures - Array of feature names from CLI --unstable option
 * @returns Array of valid, enabled feature names
 */
export function processUnstableFeatures(unstableFeatures: string[] = []): string[] {
  const validFeatures: string[] = [];

  for (const featureName of unstableFeatures) {
    const feature = UNSTABLE_FEATURES[featureName];

    if (!feature) {
      // Unknown feature - warn and ignore
      logger.warning(`Unknown unstable feature: '${featureName}'. This option will be ignored.`);
      continue;
    }

    switch (feature.status) {
      case FeatureStatus.REMOVED:
        // Removed feature - warn with removal message and ignore
        logger.warning(`[Removed] ${feature.deprecationMessage}`);
        if (feature.removalMessage) {
          logger.warning(feature.removalMessage);
        }
        break;

      case FeatureStatus.DEPRECATED:
        // Deprecated feature - warn but still apply
        logger.warning(`[Deprecated] ${feature.deprecationMessage}`);
        validFeatures.push(featureName);
        break;

      case FeatureStatus.SUPPORTED:
        // Supported feature - apply without warning
        validFeatures.push(featureName);
        break;
    }
  }

  return validFeatures;
}

/**
 * Returns a description of available unstable features for CLI help text
 *
 * @returns A string describing available features or indicating none are available
 */
export function availableFeaturesDescription(): string {
  const availableFeatures = Object.entries(UNSTABLE_FEATURES)
    .filter(([_, feature]) => feature.status === FeatureStatus.SUPPORTED)
    .map(([name]) => name);

  if (availableFeatures.length === 0) {
    return 'Currently no unstable features are available.';
  }

  return `Available features: ${availableFeatures.join(', ')}.`;
}
