import * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import { IMessageSpan } from '../../api/io/private/span';

export function countAssemblyResults(span: IMessageSpan<any>, assembly: cxapi.CloudAssembly) {
  const stacksRecursively = assembly.stacksRecursively;
  span.incCounter('stacks', stacksRecursively.length);
  span.incCounter('assemblies', asmCount(assembly));
  span.incCounter('errorAnns', sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.ERROR).length)));
  span.incCounter('warnings', sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.WARNING).length)));

  const annotationErrorCodes = stacksRecursively
    .flatMap(s => Object.values(s.metadata)
      .flatMap(ms => ms.filter(m => m.type === ANNOTATION_ERROR_CODE_TYPE)));
  for (const annotationErrorCode of annotationErrorCodes) {
    span.incCounter(`errorAnn:${annotationErrorCode.data}`);
  }

  function asmCount(x: cxapi.CloudAssembly): number {
    return 1 + x.nestedAssemblies.reduce((acc, asm) => acc + asmCount(asm.nestedAssembly), 0);
  }
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

const ANNOTATION_ERROR_CODE_TYPE = 'aws:cdk:error-code';
