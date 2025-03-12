import type { CcApiContextQuery } from '@aws-cdk/cloud-assembly-schema';
import { ICloudControlClient } from '../api';
import { type SdkProvider, initContextProviderSdk } from '../api/aws-auth/sdk-provider';
import { ContextProviderPlugin } from '../api/plugin';
import { ContextProviderError } from '../toolkit/error';
import { findJsonValue, getResultObj } from '../util';

type CcApiContextQueryGet = Required<Pick<CcApiContextQuery, 'typeName' | 'exactIdentifier' | 'propertiesToReturn' | 'account' | 'region'>>;
type CcApiContextQueryList = Required<Pick<CcApiContextQuery, 'typeName' | 'propertyMatch' | 'propertiesToReturn' | 'account' | 'region'>>;

function isGetQuery(x: CcApiContextQuery): x is CcApiContextQueryGet {
  return !!x.exactIdentifier;
}

function isListQuery(x: CcApiContextQuery): x is CcApiContextQueryList {
  return !!x.propertyMatch;
}

export class CcApiContextProviderPlugin implements ContextProviderPlugin {
  constructor(private readonly aws: SdkProvider) {
  }

  /**
   * This returns a data object with the value from CloudControl API result.
   * args.typeName - see https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html
   * args.exactIdentifier -  use CC API getResource.
   * args.propertyMatch - use CCP API listResources to get resources and propertyMatch to search through the list.
   * args.propertiesToReturn - Properties from CC API to return.
   */
  public async getValue(args: CcApiContextQuery) {
    const cloudControl = (await initContextProviderSdk(this.aws, args)).cloudControl();

    const result = await this.findResources(cloudControl, args);
    return result;
  }

  private async findResources(cc: ICloudControlClient, args: CcApiContextQuery): Promise<{[key: string]: any} []> {
    const isGet = isGetQuery(args);
    const isList = isListQuery(args);

    if (isGet && isList) {
      throw new ContextProviderError(`Specify either exactIdentifier or propertyMatch, but not both. Failed to find resources using CC API for type ${args.typeName}.`);
    }
    if (!isGet && !isList) {
      throw new ContextProviderError(`Neither exactIdentifier nor propertyMatch is specified. Failed to find resources using CC API for type ${args.typeName}.`);
    }

    if (isGet) {
      // use getResource to get the exact indentifier
      return this.getResource(cc, args);
    } else {
      // use listResource
      return this.listResources(cc, args);
    }
  }

  /**
   * Calls getResource from CC API to get the resource.
   * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/get-resource.html
   *
   * If the exactIdentifier is not found, then an empty map is returned.
   * If the resource is found, then a map of the identifier to a map of property values is returned.
   */
  private async getResource(
    cc: ICloudControlClient,
    args: CcApiContextQueryGet,
  ): Promise<{[key: string]: any}[]> {
    const resultObjs: {[key: string]: any}[] = [];
    try {
      const result = await cc.getResource({
        TypeName: args.typeName,
        Identifier: args.exactIdentifier,
      });
      const id = result.ResourceDescription?.Identifier ?? '';
      if (id !== '') {
        const propsObject = JSON.parse(result.ResourceDescription?.Properties ?? '');
        const propsObj = getResultObj(propsObject, result.ResourceDescription?.Identifier!, args.propertiesToReturn);
        resultObjs.push(propsObj);
      } else {
        throw new ContextProviderError(`Could not get resource ${args.exactIdentifier}.`);
      }
    } catch (err) {
      const dummyValue = this.getDummyValueIfErrorIgnored(args);
      if (dummyValue) {
        const propsObj = getResultObj(dummyValue, 'dummy-id', args.propertiesToReturn);
        resultObjs.push(propsObj);
        return resultObjs;
      }
      throw new ContextProviderError(`Encountered CC API error while getting resource ${args.exactIdentifier}. Error: ${err}`);
    }
    return resultObjs;
  }

  /**
   * Calls listResources from CC API to get the resources and apply args.propertyMatch to find the resources.
   * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/list-resources.html
   *
   * Since exactIdentifier is not specified, propertyMatch must be specified.
   * This returns an object where the ids are object keys and values are objects with keys of args.propertiesToReturn.
   */
  private async listResources(
    cc: ICloudControlClient,
    args: CcApiContextQueryList,
  ): Promise<{[key: string]: any}[]> {
    const resultObjs: {[key: string]: any}[] = [];

    try {
      const result = await cc.listResources({
        TypeName: args.typeName,
      });
      result.ResourceDescriptions?.forEach((resource) => {
        const id = resource.Identifier ?? '';
        if (id !== '') {
          const propsObject = JSON.parse(resource.Properties ?? '');

          const filters = Object.entries(args.propertyMatch);
          let match = false;
          if (filters) {
            match = filters.every((record, _index, _arr) => {
              const key = record[0];
              const expected = record[1];
              const actual = findJsonValue(propsObject, key);
              return propertyMatchesFilter(actual, expected);
            });

            function propertyMatchesFilter(actual: any, expected: unknown) {
              // For now we just check for strict equality, but we can implement pattern matching and fuzzy matching here later
              return expected === actual;
            }
          }

          if (match) {
            const propsObj = getResultObj(propsObject, resource.Identifier!, args.propertiesToReturn);
            resultObjs.push(propsObj);
          }
        }
      });
    } catch (err) {
      const dummyValue = this.getDummyValueIfErrorIgnored(args);
      if (dummyValue) {
        const propsObj = getResultObj(dummyValue, 'dummy-id', args.propertiesToReturn);
        resultObjs.push(propsObj);
        return resultObjs;
      }
      throw new ContextProviderError(`Could not get resources ${JSON.stringify(args.propertyMatch)}. Error: ${err}`);
    }
    return resultObjs;
  }

  private getDummyValueIfErrorIgnored(args: CcApiContextQuery): Record<string, any> | undefined {
    if (!('ignoreErrorOnMissingContext' in args) || !args.ignoreErrorOnMissingContext) {
      return undefined;
    }
    if (!('dummyValue' in args) || !Array.isArray(args.dummyValue) || args.dummyValue.length === 0) {
      return undefined;
    }
    const dummyValue = args.dummyValue[0];
    if (typeof dummyValue !== 'object' || dummyValue === null) {
      return undefined;
    }
    return dummyValue;
  }
}
