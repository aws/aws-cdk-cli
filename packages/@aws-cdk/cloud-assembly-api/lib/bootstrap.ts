/**
 * This SSM parameter does not invalidate the template
 *
 * If this string occurs in the description of an SSM parameter, the CLI
 * will not assume that the stack must always be redeployed.
 */
export const SSMPARAM_NO_INVALIDATE = '[cdk:skip]';

// Not strictly part of the cloud-assembly-api, but it definitely belongs here more than in cx-api.
