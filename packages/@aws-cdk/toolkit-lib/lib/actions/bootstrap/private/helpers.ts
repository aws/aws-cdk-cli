import * as cxapi from '@aws-cdk/cx-api';
import { ToolkitError } from '../../../api/shared-public';

/**
 * Given a set of "<account>/<region>" strings, construct environments for them
 */
export function environmentsFromDescriptors(envSpecs: string[]): cxapi.Environment[] {
  const ret = new Array<cxapi.Environment>();

  for (const spec of envSpecs) {
    const parts = spec.replace(/^aws:\/\//, '').split('/');
    if (parts.length !== 2) {
      throw new ToolkitError(`Expected environment name in format 'aws://<account>/<region>', got: ${spec}`);
    }

    ret.push({
      name: spec,
      account: parts[0],
      region: parts[1],
    });
  }

  return ret;
}
