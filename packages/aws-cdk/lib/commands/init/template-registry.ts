/**
 * Registry of public CDK templates maintained by the CDK team.
 *
 * Teams can contact the CDK team to add their templates to this registry.
 */

export interface PublicTemplateInfo {
  /** Name of the template source (repository or package) */
  readonly name: string;

  /** Short description of what the source provides */
  readonly description: string;

  /** Source type: 'git' or 'npm' */
  readonly sourceType: 'git' | 'npm';

  /** Source URL (Git repository URL or NPM package name) */
  readonly source: string;

  /** Available templates in this source */
  readonly templates?: string[];

  /** Optional template path if source contains multiple templates */
  readonly templatePath?: string;

  /** Supported languages */
  readonly languages: string[];

  /** Team or organization that authored the source */
  readonly author: string;
}

/**
 * Registry of public templates that can be discovered through `cdk init --list`
 * To add a template to this registry, contact the CDK team.
 */
export const PUBLIC_TEMPLATE_REGISTRY: PublicTemplateInfo[] = [
  {
    name: 'aws-pipeline',
    description: 'AWS CodePipeline template for CDK applications',
    sourceType: 'git',
    source: 'aws-samples/aws-codepipeline-cdkpipeline-cicd',
    templates: [],
    languages: ['typescript'],
    author: 'AWS CodePipeline Team',
  },
  {
    name: 'serverless-api',
    description: 'Serverless API templates with Lambda and API Gateway',
    sourceType: 'npm',
    source: '@aws/serverless-api-template',
    templates: ['rest-api', 'graphql-api', 'websocket-api', 'http-api'],
    languages: ['typescript', 'python', 'javascript', 'java'],
    author: 'AWS Serverless Team',
  },
  {
    name: 'multi-account',
    description: 'Multi-account CDK deployment patterns',
    sourceType: 'git',
    source: 'aws-samples/cdk-multi-account-patterns',
    templates: ['organization', 'account-vending', 'resource-sharing'],
    languages: ['typescript'],
    author: 'AWS Solutions Architects',
  },
];
