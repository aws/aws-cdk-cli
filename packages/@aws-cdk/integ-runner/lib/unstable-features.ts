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
  /** The feature name as passed to --unstable */
  readonly name: string;
  /** Current status of the feature */
  readonly status: FeatureStatus;
  /** Warning message to display when feature is used */
  readonly warningMessage: string;
  /** Optional: message to display for removed features */
  readonly removalMessage?: string;
}

/**
 * Result of processing unstable features
 */
export interface ProcessedFeatures {
  /** Features that are valid and should be applied */
  readonly validFeatures: string[];
  /** Features that were ignored (removed or unknown) */
  readonly ignoredFeatures: string[];
}

/**
 * Registry of all unstable features
 */
export const UNSTABLE_FEATURES: readonly UnstableFeature[] = [
  {
    name: 'deprecated-cli-engine',
    status: FeatureStatus.REMOVED,
    warningMessage: 'The deprecated-cli-engine option has been removed.',
    removalMessage: 'The cli-wrapper engine has been removed. The toolkit-lib engine is now the only supported engine.',
  },
  {
    name: 'toolkit-lib-engine',
    status: FeatureStatus.REMOVED,
    warningMessage: 'The toolkit-lib-engine option is no longer needed.',
    removalMessage: 'The toolkit-lib engine is now the default and only engine. This flag can be safely removed.',
  },
];

/**
 * Process unstable feature flags and emit appropriate warnings
 *
 * @param features - Array of feature names from CLI --unstable option
 * @returns ProcessedFeatures with validFeatures and ignoredFeatures
 */
export function processUnstableFeatures(features: string[] | undefined | null): ProcessedFeatures {
  const validFeatures: string[] = [];
  const ignoredFeatures: string[] = [];

  // Handle null/undefined input as empty array
  const featureList = features ?? [];

  for (const featureName of featureList) {
    const feature = UNSTABLE_FEATURES.find(f => f.name === featureName);

    if (!feature) {
      // Unknown feature - warn and ignore
      logger.warning(`Unknown unstable feature: '${featureName}'. This option will be ignored.`);
      ignoredFeatures.push(featureName);
      continue;
    }

    switch (feature.status) {
      case FeatureStatus.REMOVED:
        // Removed feature - warn with removal message and ignore
        logger.warning(`[Removed] ${feature.warningMessage}`);
        if (feature.removalMessage) {
          logger.warning(feature.removalMessage);
        }
        ignoredFeatures.push(featureName);
        break;

      case FeatureStatus.DEPRECATED:
        // Deprecated feature - warn but still apply
        logger.warning(`[Deprecated] ${feature.warningMessage}`);
        validFeatures.push(featureName);
        break;

      case FeatureStatus.SUPPORTED:
        // Supported feature - apply without warning
        validFeatures.push(featureName);
        break;
    }
  }

  return { validFeatures, ignoredFeatures };
}
