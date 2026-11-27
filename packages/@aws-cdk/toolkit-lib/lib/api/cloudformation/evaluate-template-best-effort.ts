import type { EvaluateCloudFormationTemplate } from './evaluate-cloudformation-template';
import { CfnEvaluationException, CfnUnsupportedFunctionException, parseIntrinsic } from './evaluate-cloudformation-template';
import type { Template } from './stack-helpers';
import type { UnresolvedExpression } from '../../actions/evaluate';
import { formatErrorMessage, parallelPromises } from '../../util';

/**
 * A template with as many expressions as possible replaced by their values
 */
export interface BestEffortEvaluation {
  /**
   * The template, with every expression in `Resources` and `Outputs` that could be evaluated replaced by its value
   */
  readonly template: Template;

  /**
   * The expressions that could not be evaluated
   */
  readonly unresolved: UnresolvedExpression[];
}

export interface BestEffortOptions {
  /**
   * Parameters whose values can't be used, with the reason (for example NoEcho parameters, whose deployed values
   * CloudFormation masks). Expressions that reference them are reported instead of evaluated.
   *
   * @default - all parameter values can be used
   */
  readonly unavailableParameters?: { [name: string]: string };
}

/** Attribute lookups to start at the same time, per template (calls are also limited by `SharedLookups`) */
const PREFETCH_CONCURRENCY = 8;

/** `{{resolve:ssm:...}}`, `{{resolve:secretsmanager:...}}`: resolved by CloudFormation at deployment */
const DYNAMIC_REFERENCE = /\{\{resolve:[^}]*\}\}/;

/** `{ "Ref": "AWS::NoValue" }`: the enclosing property or list element is removed */
const NO_VALUE = Symbol('AWS::NoValue');

/** Unknown truth value of a condition that could not be evaluated */
type Truth = boolean | undefined;

/**
 * Evaluates every expression in the `Resources` and `Outputs` of a template, one expression at a time.
 *
 * Expressions are evaluated with `EvaluateCloudFormationTemplate`. On top of it, this evaluates the template's
 * `Conditions` (`Fn::Equals`, `Fn::And`, `Fn::Or`, `Fn::Not`, `Condition`), `Fn::If` and `AWS::NoValue`, and drops
 * resources and outputs whose condition is false, like CloudFormation does.
 *
 * An expression that cannot be evaluated does not stop the rest: it is kept in place (with its arguments
 * evaluated where possible) and reported. When an expression fails because one of its arguments failed,
 * only the innermost failure is reported. Expressions that reference unavailable parameters (such as `NoEcho`
 * parameters, whose deployed values CloudFormation masks) are reported rather than evaluated.
 *
 * Only evaluation failures are reported this way. Any other error (for example expired credentials, throttling,
 * or a lookup that failed for a reason other than the resource or attribute not being found or readable) is thrown.
 */
export async function evaluateTemplateBestEffort(
  evaluator: EvaluateCloudFormationTemplate,
  template: Template,
  options: BestEffortOptions = {},
): Promise<BestEffortEvaluation> {
  const unresolved: UnresolvedExpression[] = [];
  const conditions = new Map<string, Promise<Truth>>();
  const unavailable = options.unavailableParameters ?? {};
  const noEcho = new Set(Object.keys(unavailable));
  // The same expression has the same value everywhere in a stack: evaluate it once (saves repeated lookups).
  // Only values and evaluation failures are kept; anything else is thrown and not remembered.
  const evaluations = new Map<string, Promise<any>>();
  const evaluateOnce = (node: any): Promise<any> => {
    const key = JSON.stringify(node);
    if (!evaluations.has(key)) {
      evaluations.set(key, evaluator.evaluateCfnExpression(node).catch((e) => {
        if (!isUnresolvable(e)) {
          evaluations.delete(key);
        }
        throw e;
      }));
    }
    return evaluations.get(key)!;
  };

  function condition(name: string): Promise<Truth> {
    if (!conditions.has(name)) {
      const definition = template.Conditions?.[name];
      conditions.set(name, definition === undefined
        ? Promise.resolve(undefined)
        : conditionValue(definition, `Conditions.${name}`));
    }
    return conditions.get(name)!;
  }

  async function conditionValue(expr: any, path: string): Promise<Truth> {
    if (expr !== null && typeof expr === 'object' && !Array.isArray(expr)) {
      if (typeof expr.Condition === 'string' && Object.keys(expr).length === 1) {
        return condition(expr.Condition);
      }
      const [fn] = Object.keys(expr);
      const args = expr[fn];
      switch (fn) {
        case 'Fn::Equals': {
          const [a, b] = [await evaluate(args[0], `${path}.Fn::Equals.0`), await evaluate(args[1], `${path}.Fn::Equals.1`)];
          return containsExpression(a) || containsExpression(b) ? undefined : JSON.stringify(asCfnValue(a)) === JSON.stringify(asCfnValue(b));
        }
        case 'Fn::Not': {
          const v = await conditionValue(args[0], `${path}.Fn::Not.0`);
          return v === undefined ? undefined : !v;
        }
        case 'Fn::And':
        case 'Fn::Or': {
          const values: Truth[] = [];
          for (const [i, arg] of args.entries()) {
            values.push(await conditionValue(arg, `${path}.${fn}.${i}`));
          }
          const decisive = fn === 'Fn::And' ? false : true;
          if (values.includes(decisive)) {
            return decisive;
          }
          return values.includes(undefined) ? undefined : !decisive;
        }
      }
    }
    const value = await evaluate(expr, path);
    return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
  }

  /** `{ "Fn::X": { "Ref": "AWS::NoValue" } }`: CloudFormation rejects it, so keep the expression and report it */
  function noValueArgument(node: any, intrinsic: string, path: string) {
    unresolved.push({ path, intrinsic, reason: 'its argument is AWS::NoValue' });
    return node;
  }

  async function evaluate(node: any, path: string): Promise<any> {
    if (Array.isArray(node)) {
      const out = [];
      for (const [i, x] of node.entries()) {
        const value = await evaluate(x, `${path}.${i}`);
        if (value !== NO_VALUE) {
          out.push(value);
        }
      }
      return out;
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' && DYNAMIC_REFERENCE.test(node)) {
        unresolved.push({ path, intrinsic: 'DynamicReference', reason: 'contains a dynamic reference, which CloudFormation resolves at deployment' });
      }
      return node;
    }
    const intrinsic = intrinsicName(node);
    if (!intrinsic) {
      const out: { [key: string]: any } = {};
      for (const [key, value] of Object.entries(node)) {
        const evaluated = await evaluate(value, `${path}.${key}`);
        if (evaluated !== NO_VALUE) {
          out[key] = evaluated;
        }
      }
      return out;
    }

    if (intrinsic === 'Ref' && node.Ref === 'AWS::NoValue') {
      return NO_VALUE;
    }
    if (intrinsic === 'Fn::If') {
      const [conditionName, whenTrue, whenFalse] = node['Fn::If'];
      const truth = await condition(conditionName);
      if (truth === undefined) {
        unresolved.push({ path, intrinsic, reason: `condition '${conditionName}' could not be evaluated` });
        return node;
      }
      return evaluate(truth ? whenTrue : whenFalse, `${path}.Fn::If.${truth ? 1 : 2}`);
    }

    const masked = noEchoReferences(node, noEcho);
    if (masked.length > 0) {
      // Don't evaluate: the deployed value is masked, and the evaluator would fall back to the template default
      const before = unresolved.length;
      const args = intrinsic === 'Ref' ? node.Ref : await evaluate(node[intrinsic], `${path}.${intrinsic}`);
      if (args === NO_VALUE) {
        return noValueArgument(node, intrinsic, path);
      }
      if (intrinsic !== 'Ref' && unresolved.length === before && noEchoReferences({ [intrinsic]: args }, noEcho).length === 0) {
        // the references were only in Fn::If branches that weren't taken
        return evaluate({ [intrinsic]: args }, path);
      }
      if (unresolved.length === before) {
        unresolved.push({ path, intrinsic, reason: masked.map((m) => `references parameter '${m}': ${unavailable[m]}`).join('; ') });
      }
      return { [intrinsic]: args };
    }
    try {
      const value = await evaluateOnce(node);
      if (value === undefined) {
        unresolved.push({ path, intrinsic, reason: 'the expression evaluated to no value' });
        return node;
      }
      if (typeof value === 'string' && DYNAMIC_REFERENCE.test(value)) {
        unresolved.push({ path, intrinsic, reason: 'evaluates to a dynamic reference, which CloudFormation resolves at deployment' });
        return node;
      }
      return value;
    } catch (e) {
      if (!isUnresolvable(e)) {
        throw e;
      }
      const before = unresolved.length;
      const args = await evaluate(node[intrinsic], `${path}.${intrinsic}`);
      if (args === NO_VALUE) {
        return noValueArgument(node, intrinsic, path);
      }
      const unsupported = e instanceof CfnUnsupportedFunctionException && e.functionName === intrinsic;
      if (!unsupported && unresolved.length === before && !containsExpression(args)) {
        // The arguments contained expressions only this function evaluates (Fn::If, AWS::NoValue): retry with their values
        try {
          return await evaluateOnce({ [intrinsic]: args });
        } catch (retryError) {
          if (!isUnresolvable(retryError)) {
            throw retryError;
          }
          unresolved.push({ path, intrinsic, reason: formatErrorMessage(retryError) });
          return { [intrinsic]: args };
        }
      }
      if (unsupported || unresolved.length === before) {
        unresolved.push({ path, intrinsic, reason: formatErrorMessage(e) });
      }
      return { [intrinsic]: args };
    }
  }

  async function evaluateSection(section: { [logicalId: string]: any }, name: string) {
    const out: { [logicalId: string]: any } = {};
    for (const [logicalId, element] of Object.entries(section)) {
      if (typeof element?.Condition === 'string' && (await condition(element.Condition)) === false) {
        continue; // not created by CloudFormation
      }
      out[logicalId] = await evaluate(element, `${name}.${logicalId}`);
    }
    return out;
  }

  // Attribute lookups are the slow part: run the distinct ones up front, a few at a time, so the walk below gets them
  // from `evaluations`. Only lookups the walk will make are run (not those in elements or Fn::If branches that
  // CloudFormation didn't create). Evaluation failures are kept for the walk to report; any other error is thrown.
  const lookups = new Map<string, any>();
  async function collectLookups(value: any): Promise<void> {
    if (Array.isArray(value)) {
      for (const x of value) {
        await collectLookups(x);
      }
    } else if (value !== null && typeof value === 'object') {
      const intrinsic = intrinsicName(value);
      if (intrinsic === 'Fn::GetAtt' && !containsExpression(value['Fn::GetAtt'])) {
        lookups.set(JSON.stringify(value), value);
      } else if (intrinsic === 'Fn::Sub') {
        // ${Resource.Attribute} placeholders are attribute lookups too
        const [text, vars] = Array.isArray(value['Fn::Sub']) ? value['Fn::Sub'] : [value['Fn::Sub'], {}];
        for (const m of String(text).matchAll(/\$\{([^}!][^}]*)\}/g)) {
          const [resource, ...attribute] = m[1].split('.');
          if (attribute.length > 0 && !(m[1] in (vars ?? {}))) {
            const node = { 'Fn::GetAtt': [resource, attribute.join('.')] };
            lookups.set(JSON.stringify(node), node);
          }
        }
        await collectLookups(vars);
      } else if (intrinsic === 'Fn::If') {
        const [conditionName, whenTrue, whenFalse] = value['Fn::If'];
        const truth = await condition(conditionName);
        if (truth !== undefined) {
          await collectLookups(truth ? whenTrue : whenFalse);
        }
      } else {
        for (const x of Object.values(value)) {
          await collectLookups(x);
        }
      }
    }
  }
  for (const section of ['Resources', 'Outputs']) {
    for (const element of Object.values<any>(template[section] ?? {})) {
      if (!(typeof element?.Condition === 'string' && (await condition(element.Condition)) === false)) {
        await collectLookups(element);
      }
    }
  }
  await parallelPromises(PREFETCH_CONCURRENCY, [...lookups.values()].map((node) => async () => {
    try {
      await evaluateOnce(node);
    } catch (e) {
      if (!isUnresolvable(e)) {
        throw e;
      }
    }
  }));

  const evaluated: Template = { ...template };
  for (const section of ['Resources', 'Outputs']) {
    if (template[section]) {
      evaluated[section] = await evaluateSection(template[section], section);
    }
  }
  return { template: evaluated, unresolved };
}

function intrinsicName(node: { [key: string]: any }): string | undefined {
  return parseIntrinsic(node)?.name;
}

/**
 * Lookup errors that mean the value doesn't exist or can't be read this way, rather than that the lookup itself failed
 */
const NOT_FOUND_ERRORS = new Set([
  'ResourceNotFoundException',
  'TypeNotFoundException',
  'UnsupportedActionException',
  'InvalidRequestException',
  'ValidationException',
  // the resource type's Cloud Control handler failed to read the resource
  'HandlerFailureException',
  'HandlerInternalFailureException',
  'GeneralServiceException',
  // the credentials can't read this resource (e.g. least-privilege credentials, or a handler that needs more permissions);
  // credentials that can't read the stack at all already fail on DescribeStacks
  'AccessDeniedException',
]);

/**
 * An evaluation failure that can be reported as unresolved: the evaluator could not evaluate the expression,
 * not because a call to AWS failed (expired credentials, throttling, network)
 */
function isUnresolvable(e: unknown): boolean {
  if (!(e instanceof CfnEvaluationException)) {
    return false;
  }
  const cause = (e as { cause?: unknown }).cause;
  if (cause === undefined || cause instanceof CfnEvaluationException) {
    return cause === undefined || isUnresolvable(cause);
  }
  return NOT_FOUND_ERRORS.has((cause as { name?: string }).name ?? '');
}

/** Compare values the way CloudFormation does: scalars as strings (a deployed parameter `'10'` equals `10`) */
function asCfnValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(asCfnValue);
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
}

/** The NoEcho parameters an expression references, directly or through `Fn::Sub` placeholders */
function noEchoReferences(node: any, noEcho: Set<string>): string[] {
  if (noEcho.size === 0) {
    return [];
  }
  const found = new Set<string>();
  const visit = (x: any) => {
    if (Array.isArray(x)) {
      x.forEach(visit);
    } else if (x !== null && typeof x === 'object') {
      if (typeof x.Ref === 'string' && noEcho.has(x.Ref)) {
        found.add(x.Ref);
      }
      if ('Fn::Sub' in x) {
        const [text, vars] = Array.isArray(x['Fn::Sub']) ? x['Fn::Sub'] : [x['Fn::Sub'], {}];
        for (const m of String(text).matchAll(/\$\{([^}!][^}]*)\}/g)) {
          if (noEcho.has(m[1]) && !(m[1] in (vars ?? {}))) {
            found.add(m[1]);
          }
        }
      }
      Object.values(x).forEach(visit);
    }
  };
  visit(node);
  return [...found];
}

export function containsExpression(value: any): boolean {
  if (Array.isArray(value)) {
    return value.some(containsExpression);
  }
  if (value !== null && typeof value === 'object') {
    return intrinsicName(value) !== undefined || Object.values(value).some(containsExpression);
  }
  return false;
}
