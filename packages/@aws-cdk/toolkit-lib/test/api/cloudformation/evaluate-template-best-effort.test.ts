import type { EvaluateCloudFormationTemplate } from '../../../lib/api/cloudformation';
import { CfnEvaluationException, CfnUnsupportedFunctionException, evaluateTemplateBestEffort } from '../../../lib/api/cloudformation';

/**
 * An evaluator that knows a fixed set of Refs and Fn::Join, and fails on everything else,
 * mirroring how EvaluateCloudFormationTemplate evaluates nested arguments.
 */
function fakeEvaluator(refs: { [logicalId: string]: string }): EvaluateCloudFormationTemplate {
  async function evaluateCfnExpression(expr: any): Promise<any> {
    if (Array.isArray(expr)) {
      const out = [];
      for (const x of expr) {
        out.push(await evaluateCfnExpression(x));
      }
      return out;
    }
    if (expr === null || typeof expr !== 'object') {
      return expr;
    }
    if ('Ref' in expr) {
      if (expr.Ref in refs) {
        return refs[expr.Ref];
      }
      throw new CfnEvaluationException(`Parameter or resource '${expr.Ref}' could not be found for evaluation`);
    }
    if ('Fn::Join' in expr) {
      const [sep, parts] = expr['Fn::Join'];
      return (await evaluateCfnExpression(parts)).join(sep);
    }
    throw new CfnUnsupportedFunctionException(Object.keys(expr)[0]);
  }
  return { evaluateCfnExpression } as unknown as EvaluateCloudFormationTemplate;
}

/** An evaluator whose every evaluation fails with the given error */
function failingEvaluator(error: Error): EvaluateCloudFormationTemplate & { calls: number } {
  const evaluator = {
    calls: 0,
    async evaluateCfnExpression(): Promise<any> {
      evaluator.calls++;
      throw error;
    },
  };
  return evaluator as unknown as EvaluateCloudFormationTemplate & { calls: number };
}

describe('evaluateTemplateBestEffort', () => {
  test('replaces every expression it can evaluate, in Resources and Outputs', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({ 'Bucket': 'my-bucket', 'AWS::Region': 'us-east-1' }), {
      Resources: {
        Param: { Type: 'AWS::SSM::Parameter', Properties: { Value: { Ref: 'Bucket' }, Tags: [{ Key: 'k', Value: 'literal' }] } },
      },
      Outputs: {
        Joined: { Value: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, { Ref: 'AWS::Region' }]] } },
      },
    });

    expect(result.unresolved).toEqual([]);
    expect(result.template.Resources.Param.Properties).toEqual({ Value: 'my-bucket', Tags: [{ Key: 'k', Value: 'literal' }] });
    expect(result.template.Outputs.Joined.Value).toEqual('my-bucket-us-east-1');
  });

  test('keeps expressions it cannot evaluate, without affecting the others', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({ Bucket: 'my-bucket' }), {
      Resources: {
        Param: {
          Type: 'AWS::SSM::Parameter',
          Properties: {
            Value: { Ref: 'Bucket' },
            Description: { 'Fn::GetAZs': '' },
          },
        },
      },
    });

    expect(result.template.Resources.Param.Properties).toEqual({
      Value: 'my-bucket',
      Description: { 'Fn::GetAZs': '' },
    });
    expect(result.unresolved).toEqual([{
      path: 'Resources.Param.Properties.Description',
      intrinsic: 'Fn::GetAZs',
      reason: 'CloudFormation function Fn::GetAZs is not supported',
    }]);
  });

  test('reports only the innermost failure, and evaluates the arguments around it', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({ Bucket: 'my-bucket' }), {
      Outputs: {
        Joined: { Value: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, { Ref: 'Missing' }]] } },
      },
    });

    expect(result.template.Outputs.Joined.Value).toEqual({ 'Fn::Join': ['-', ['my-bucket', { Ref: 'Missing' }]] });
    expect(result.unresolved).toEqual([{
      path: 'Outputs.Joined.Value.Fn::Join.1.1',
      intrinsic: 'Ref',
      reason: "Parameter or resource 'Missing' could not be found for evaluation",
    }]);
  });

  test('reports an unsupported function itself, rather than its arguments', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({}), {
      Outputs: { Azs: { Value: { 'Fn::Select': [0, { 'Fn::GetAZs': 'us-east-1' }] } } },
    });

    expect(result.unresolved.map((u) => [u.path, u.intrinsic])).toEqual([
      ['Outputs.Azs.Value.Fn::Select.1', 'Fn::GetAZs'],
      ['Outputs.Azs.Value', 'Fn::Select'],
    ]);
  });

  test('reports an expression that evaluates to no value, rather than dropping the property', async () => {
    const evaluator = { evaluateCfnExpression: async () => undefined } as unknown as EvaluateCloudFormationTemplate;

    const result = await evaluateTemplateBestEffort(evaluator, { Outputs: { O: { Value: { 'Fn::Select': [5, ['a']] } } } });

    expect(result.template.Outputs.O.Value).toEqual({ 'Fn::Select': [5, ['a']] });
    expect(result.unresolved).toEqual([{ path: 'Outputs.O.Value', intrinsic: 'Fn::Select', reason: 'the expression evaluated to no value' }]);
  });

  test('reports dynamic references, which CloudFormation resolves at deployment', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({ Secret: '{{resolve:secretsmanager:MySecret:SecretString:password}}' }), {
      Resources: {
        Db: {
          Type: 'AWS::RDS::DBInstance',
          Properties: { MasterUserPassword: { Ref: 'Secret' }, Parameter: '{{resolve:ssm:/my/param}}', Other: 'plain' },
        },
      },
    });

    expect(result.template.Resources.Db.Properties).toEqual({ MasterUserPassword: { Ref: 'Secret' }, Parameter: '{{resolve:ssm:/my/param}}', Other: 'plain' });
    expect(result.unresolved.map((u) => [u.path, u.intrinsic])).toEqual([
      ['Resources.Db.Properties.MasterUserPassword', 'Ref'],
      ['Resources.Db.Properties.Parameter', 'DynamicReference'],
    ]);
  });

  test('leaves the other template sections untouched', async () => {
    const template = {
      Parameters: { Env: { Type: 'String', Default: { Ref: 'NotEvaluated' } } },
      Mappings: { M: { K: { V: { Ref: 'NotEvaluated' } } } },
      Resources: {},
    };

    const result = await evaluateTemplateBestEffort(fakeEvaluator({}), template);

    expect(result.template.Parameters).toBe(template.Parameters);
    expect(result.template.Mappings).toBe(template.Mappings);
    expect(result.unresolved).toEqual([]);
  });

  describe('conditions', () => {
    const conditions = {
      IsProd: { 'Fn::Equals': [{ Ref: 'Env' }, 'prod'] },
      IsDev: { 'Fn::Not': [{ Condition: 'IsProd' }] },
      IsProdInUsEast1: { 'Fn::And': [{ Condition: 'IsProd' }, { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-east-1'] }] },
      IsProdOrDev: { 'Fn::Or': [{ Condition: 'IsProd' }, { Condition: 'IsDev' }] },
      Unknowable: { 'Fn::Equals': [{ Ref: 'Missing' }, 'x'] },
    };
    const evaluator = fakeEvaluator({ 'Env': 'prod', 'AWS::Region': 'us-east-1', 'Bucket': 'my-bucket' });

    test('picks the Fn::If branch of the evaluated condition', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Outputs: {
          A: { Value: { 'Fn::If': ['IsProd', 'prod-value', 'dev-value'] } },
          B: { Value: { 'Fn::If': ['IsDev', 'dev-value', { Ref: 'Bucket' }] } },
          C: { Value: { 'Fn::If': ['IsProdInUsEast1', 'yes', 'no'] } },
          D: { Value: { 'Fn::If': ['IsProdOrDev', 'yes', 'no'] } },
        },
      });

      expect(result.unresolved).toEqual([]);
      expect(Object.fromEntries(Object.entries(result.template.Outputs).map(([k, v]: [string, any]) => [k, v.Value]))).toEqual({
        A: 'prod-value', B: 'my-bucket', C: 'yes', D: 'yes',
      });
    });

    test('removes properties and list elements that are AWS::NoValue', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Resources: {
          Bucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: { 'Fn::If': ['IsDev', 'dev-bucket', { Ref: 'AWS::NoValue' }] },
              Tags: [{ Key: 'a', Value: '1' }, { 'Fn::If': ['IsDev', { Key: 'b', Value: '2' }, { Ref: 'AWS::NoValue' }] }],
            },
          },
        },
      });

      expect(result.unresolved).toEqual([]);
      expect(result.template.Resources.Bucket.Properties).toEqual({ Tags: [{ Key: 'a', Value: '1' }] });
    });

    test('reports a function whose whole argument is AWS::NoValue, instead of leaking it', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Outputs: { Encoded: { Value: { 'Fn::Base64': { 'Fn::If': ['IsDev', 'dev', { Ref: 'AWS::NoValue' }] } } } },
      });

      expect(result.template.Outputs.Encoded.Value).toEqual({ 'Fn::Base64': { 'Fn::If': ['IsDev', 'dev', { Ref: 'AWS::NoValue' }] } });
      expect(result.unresolved).toEqual([{ path: 'Outputs.Encoded.Value', intrinsic: 'Fn::Base64', reason: 'its argument is AWS::NoValue' }]);
    });

    test('evaluates functions whose arguments contain Fn::If', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Outputs: { Joined: { Value: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, { 'Fn::If': ['IsProd', 'prod', 'dev'] }]] } } },
      });

      expect(result.unresolved).toEqual([]);
      expect(result.template.Outputs.Joined.Value).toEqual('my-bucket-prod');
    });

    test('drops resources and outputs whose condition is false', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Resources: {
          ProdOnly: { Type: 'AWS::SNS::Topic', Condition: 'IsProd' },
          DevOnly: { Type: 'AWS::SNS::Topic', Condition: 'IsDev' },
        },
        Outputs: { DevOutput: { Condition: 'IsDev', Value: 'x' } },
      });

      expect(Object.keys(result.template.Resources)).toEqual(['ProdOnly']);
      expect(result.template.Outputs).toEqual({});
    });

    test('keeps Fn::If and reports it when the condition cannot be evaluated', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Conditions: conditions,
        Outputs: { Value: { Value: { 'Fn::If': ['Unknowable', 'a', 'b'] } } },
      });

      expect(result.template.Outputs.Value.Value).toEqual({ 'Fn::If': ['Unknowable', 'a', 'b'] });
      expect(result.unresolved).toEqual([
        { path: 'Conditions.Unknowable.Fn::Equals.0', intrinsic: 'Ref', reason: "Parameter or resource 'Missing' could not be found for evaluation" },
        { path: 'Outputs.Value.Value', intrinsic: 'Fn::If', reason: "condition 'Unknowable' could not be evaluated" },
      ]);
    });
  });

  describe('unavailable parameters', () => {
    const parameters = { Secret: { Type: 'String', NoEcho: true }, Env: { Type: 'String' } };
    // CloudFormation returns '****' for NoEcho values: the evaluator would happily use it
    const evaluator = fakeEvaluator({ Secret: '****', Env: 'prod', Bucket: 'my-bucket' });
    const options = { unavailableParameters: { Secret: 'NoEcho parameter' } };

    test('reports expressions that reference them instead of evaluating them', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Parameters: parameters,
        Outputs: {
          Direct: { Value: { Ref: 'Secret' } },
          Joined: { Value: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, { Ref: 'Secret' }]] } },
          Sub: { Value: { 'Fn::Sub': 'password=${Secret}' } },
        },
      }, options);

      expect(result.template.Outputs.Direct.Value).toEqual({ Ref: 'Secret' });
      expect(result.template.Outputs.Joined.Value).toEqual({ 'Fn::Join': ['-', ['my-bucket', { Ref: 'Secret' }]] });
      expect(result.template.Outputs.Sub.Value).toEqual({ 'Fn::Sub': 'password=${Secret}' });
      expect(result.unresolved.map((u) => [u.path, u.intrinsic])).toEqual([
        ['Outputs.Direct.Value', 'Ref'],
        ['Outputs.Joined.Value.Fn::Join.1.1', 'Ref'],
        ['Outputs.Sub.Value', 'Fn::Sub'],
      ]);
      expect(result.unresolved[0].reason).toEqual("references parameter 'Secret': NoEcho parameter");
    });

    test('a condition that uses one cannot be evaluated', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Parameters: parameters,
        Conditions: { HasSecret: { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'Secret' }, ''] }] } },
        Outputs: { Value: { Value: { 'Fn::If': ['HasSecret', 'yes', 'no'] } } },
      }, options);

      expect(result.template.Outputs.Value.Value).toEqual({ 'Fn::If': ['HasSecret', 'yes', 'no'] });
      expect(result.unresolved.map((u) => u.intrinsic)).toEqual(['Ref', 'Fn::If']);
    });

    test('only references in the Fn::If branch that is taken count', async () => {
      const result = await evaluateTemplateBestEffort(evaluator, {
        Parameters: parameters,
        Conditions: { IsProd: { 'Fn::Equals': [{ Ref: 'Env' }, 'prod'] } },
        Outputs: {
          Value: { Value: { 'Fn::If': ['IsProd', 'prod', { Ref: 'Secret' }] } },
          Joined: { Value: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, { 'Fn::If': ['IsProd', 'prod', { Ref: 'Secret' }] }]] } },
        },
      }, options);

      expect(result.unresolved).toEqual([]);
      expect(result.template.Outputs.Value.Value).toEqual('prod');
      expect(result.template.Outputs.Joined.Value).toEqual('my-bucket-prod');
    });
  });

  test('compares values in Fn::Equals the way CloudFormation does', async () => {
    const result = await evaluateTemplateBestEffort(fakeEvaluator({ Size: '10', Flag: 'true' }), {
      Conditions: {
        IsTen: { 'Fn::Equals': [{ Ref: 'Size' }, 10] },
        IsFlag: { 'Fn::Equals': [true, { Ref: 'Flag' }] },
      },
      Resources: {
        WhenTen: { Type: 'AWS::SNS::Topic', Condition: 'IsTen' },
        WhenFlag: { Type: 'AWS::SNS::Topic', Condition: 'IsFlag' },
      },
    });

    expect(Object.keys(result.template.Resources)).toEqual(['WhenTen', 'WhenFlag']);
  });

  describe('errors', () => {
    const template = { Outputs: { A: { Value: { Ref: 'X' } }, B: { Value: { Ref: 'X' } } } };

    test('throws errors that are not evaluation failures', async () => {
      await expect(evaluateTemplateBestEffort(failingEvaluator(new TypeError('boom')), template)).rejects.toThrow('boom');
    });

    test('throws lookup failures caused by AWS errors such as throttling or expired credentials', async () => {
      const cause = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      const evaluator = failingEvaluator(new CfnEvaluationException('Could not find attribute', { cause }));

      await expect(evaluateTemplateBestEffort(evaluator, template)).rejects.toThrow('Could not find attribute');
    });

    test('looks up attributes before the walk, a few at a time, and throws lookup failures from the walk', async () => {
      let running = 0;
      let maxRunning = 0;
      const cause = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      const evaluator = {
        calls: [] as string[],
        async evaluateCfnExpression(expr: any): Promise<any> {
          evaluator.calls.push(JSON.stringify(expr));
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
          if (expr['Fn::GetAtt'][0] === 'Throttled') {
            throw new CfnEvaluationException('Could not find attribute', { cause });
          }
          return `${expr['Fn::GetAtt'][0]}.${expr['Fn::GetAtt'][1]}`;
        },
      };
      const outputs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`O${i}`, { Value: { 'Fn::GetAtt': [`R${i}`, 'Arn'] } }]));

      const result = await evaluateTemplateBestEffort(evaluator as unknown as EvaluateCloudFormationTemplate, { Outputs: outputs });
      expect(maxRunning).toEqual(8);
      expect(evaluator.calls).toHaveLength(12);
      expect(result.template.Outputs.O11.Value).toEqual('R11.Arn');

      await expect(evaluateTemplateBestEffort(evaluator as unknown as EvaluateCloudFormationTemplate, {
        Outputs: { ...outputs, Bad: { Value: { 'Fn::GetAtt': ['Throttled', 'Arn'] } } },
      })).rejects.toThrow('Could not find attribute');
    });

    test('only looks up attributes in elements and Fn::If branches that CloudFormation creates', async () => {
      const evaluator = {
        calls: [] as string[],
        async evaluateCfnExpression(expr: any): Promise<any> {
          if ('Fn::GetAtt' in expr) {
            evaluator.calls.push(expr['Fn::GetAtt'][0]);
            return 'value';
          }
          if ('Fn::Equals' in expr) {
            return false;
          }
          return expr;
        },
      };

      await evaluateTemplateBestEffort(evaluator as unknown as EvaluateCloudFormationTemplate, {
        Conditions: { Never: { 'Fn::Equals': ['a', 'b'] } },
        Resources: { NotCreated: { Type: 'AWS::SNS::Topic', Condition: 'Never', Properties: { A: { 'Fn::GetAtt': ['InNotCreated', 'Arn'] } } } },
        Outputs: { O: { Value: { 'Fn::If': ['Never', { 'Fn::GetAtt': ['InUntakenBranch', 'Arn'] }, { 'Fn::GetAtt': ['InTakenBranch', 'Arn'] }] } } },
      });

      expect(evaluator.calls).toEqual(['InTakenBranch']);
    });

    test('also looks up attributes referenced in Fn::Sub placeholders up front', async () => {
      const evaluator = {
        calls: [] as string[],
        async evaluateCfnExpression(expr: any): Promise<any> {
          evaluator.calls.push(JSON.stringify(expr));
          return 'x';
        },
      };

      await evaluateTemplateBestEffort(evaluator as unknown as EvaluateCloudFormationTemplate, {
        Outputs: { O: { Value: { 'Fn::Sub': ['${Topic.TopicName}-${AWS::Region}-${!Literal}-${Var}', { Var: { 'Fn::GetAtt': ['Queue', 'Arn'] } }] } } },
      });

      // the two lookups run before the walk evaluates the Fn::Sub itself
      expect(evaluator.calls.slice(0, 2).sort()).toEqual([
        JSON.stringify({ 'Fn::GetAtt': ['Queue', 'Arn'] }),
        JSON.stringify({ 'Fn::GetAtt': ['Topic', 'TopicName'] }),
      ]);
    });

    test('reports lookups the credentials are not allowed to make', async () => {
      const cause = Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });

      const result = await evaluateTemplateBestEffort(failingEvaluator(new CfnEvaluationException('Could not find attribute', { cause })), template);

      expect(result.unresolved.map((u) => u.path)).toEqual(['Outputs.A.Value', 'Outputs.B.Value']);
    });

    test('treats a failed lookup inside another evaluation failure like the inner failure', async () => {
      const notFound = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });
      const handlerFailed = Object.assign(new Error('handler failed'), { name: 'HandlerFailureException' });
      const throttled = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      const wrapped = (cause: Error) => new CfnEvaluationException('outer', { cause: new CfnEvaluationException('inner', { cause }) });

      expect((await evaluateTemplateBestEffort(failingEvaluator(wrapped(notFound)), template)).unresolved).toHaveLength(2);
      expect((await evaluateTemplateBestEffort(failingEvaluator(new CfnEvaluationException('x', { cause: handlerFailed })), template)).unresolved)
        .toHaveLength(2);
      await expect(evaluateTemplateBestEffort(failingEvaluator(wrapped(throttled)), template)).rejects.toThrow('outer');
    });

    test('reports lookups of resources that do not exist, and evaluates the same expression only once', async () => {
      const cause = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });
      const evaluator = failingEvaluator(new CfnEvaluationException('Could not find attribute', { cause }));

      const result = await evaluateTemplateBestEffort(evaluator, template);

      expect(result.unresolved.map((u) => u.path)).toEqual(['Outputs.A.Value', 'Outputs.B.Value']);
      expect(evaluator.calls).toEqual(1);
    });
  });
});
