import { deserializeStructure } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/sdk';

/**
 * Fetch and parse a stack's (original) template. Returns `undefined` if it can't be read —
 * investigations are best-effort, so a failed read is logged at debug and diagnosis
 * continues without the template.
 */
export async function getStackTemplate(
  cfn: ICloudFormationClient,
  stackName: string,
  debug: (msg: string) => Promise<void>,
): Promise<any | undefined> {
  try {
    const resp = await cfn.getTemplate({ StackName: stackName, TemplateStage: 'Original' });
    if (!resp.TemplateBody) {
      await debug(`Stack template for ${stackName}: empty template body`);
      return undefined;
    }
    return deserializeStructure(resp.TemplateBody);
  } catch (e: any) {
    await debug(`Stack template for ${stackName}: failed to read: ${e.message}`);
    return undefined;
  }
}
