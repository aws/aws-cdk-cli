interface CiSystem {
  /**
   * What's the name?
   */
  readonly name: string;

  /**
   * What environment variable indicates that we are running on this system?
   */
  readonly detectEnvVar: string;

  /**
   * Whether or not this CI system can be configured to fail on messages written to stderr
   *
   * With "can be configured", what we mean is that a checkbox or configuration
   * flag to enable this behavior comes out of the box with the CI system and (judgement
   * call), this flag is "commonly" used.
   *
   * Of course every CI system can be scripted to have this behavior, but that's
   * not what we mean.
   */
  readonly canBeConfiguredToFailOnStdErr: boolean;
}

const CI_SYSTEMS: CiSystem[] = [
  {
    name: 'Azure DevOps',
    // https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml
    detectEnvVar: 'TF_BUILD',
    canBeConfiguredToFailOnStdErr: true,
  },
  {
    name: 'TeamCity',
    // https://www.jetbrains.com/help/teamcity/predefined-build-parameters.html
    detectEnvVar: 'TEAMCITY_VERSION',
    // Can be configured to fail on stderr, when using a PowerShell task
    canBeConfiguredToFailOnStdErr: true,
  },
  {
    name: 'GitHub Actions',
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
    detectEnvVar: 'GITHUB_ACTION',
    canBeConfiguredToFailOnStdErr: false,
  },
  {
    name: 'CodeBuild',
    // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html
    detectEnvVar: 'CODEBUILD_BUILD_ID',
    canBeConfiguredToFailOnStdErr: false,
  },
  {
    name: 'CircleCI',
    // https://circleci.com/docs/variables/#built-in-environment-variables
    detectEnvVar: 'CIRCLECI',
    canBeConfiguredToFailOnStdErr: false,
  },
  {
    name: 'Jenkins',
    // https://www.jenkins.io/doc/book/pipeline/jenkinsfile/#using-environment-variables
    detectEnvVar: 'EXECUTOR_NUMBER',
    canBeConfiguredToFailOnStdErr: false,
  },
];

export function detectCiSystem(): CiSystem | undefined {
  for (const ciSystem of CI_SYSTEMS) {
    if (process.env[ciSystem.detectEnvVar]) {
      return ciSystem;
    }
  }
  return undefined;
}

/**
 * Return whether the CI system we're detecting is safe to write to stderr on
 *
 * Returns `undefined` if the current CI system cannot be recognized.
 */
export function ciSystemIsStdErrSafe(): boolean | undefined {
  const x = detectCiSystem()?.canBeConfiguredToFailOnStdErr;
  return x === undefined ? undefined : !x;
}
