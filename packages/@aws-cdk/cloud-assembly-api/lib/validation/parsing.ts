/**
 * Report whether it is possible to suppress this violation.
 *
 * Violations that are reported as "fatal", or that have been converted from annotations, cannot be suppressed.
 */
export function isSuppressibleViolation(violation: { severity?: string; ruleMetadata?: { [key: string]: string } }): boolean {
  const isFatal = violation.severity?.toLowerCase() === 'fatal';
  const isErrorAnnotation = violation.ruleMetadata?.['cdk:annotation'] && violation.severity?.toLowerCase() === 'error';
  return !isFatal && !isErrorAnnotation;
}

export interface ValidationId {
  readonly namespace?: Namespace;
  readonly ruleId: string;
}

/**
 * Parse a validation ID into a namespace and rule name.
 *
 * `::` is used to separate the namespace from the rule name. If no namespace is provided, the `annotation` namespace is assumed.
 *
 * The rule name may not contain `::`, except between brackets.
 *
 * Right now, this parses and validates balanced brackets, because we assume the
 * people who invent identifiers are not maniacs.  If it turns out this causes
 * too many problems, we can remove matching bracket validation and just check
 * for whether any brackets are open, not necessarily whether they match.
 */
export function parseValidationId(id: string): ValidationId {
  let nsSeparator: undefined | number = undefined;

  // Parser loop
  const braceStack: string[] = [];
  for (let i = 0; i < id.length; i++) {
    const c = id[i];
    if (c === ':' && id[i + 1] === ':' && braceStack.length === 0) {
      // Found a namespace separator
      if (nsSeparator !== undefined) {
        throw new Error(`Invalid validation rule ID '${id}'. The '::' delimiter is reserved for separating the prefix from the rule name (e.g. 'prefix::RuleName').`);
      }

      nsSeparator = i;
      i += 1;
    } else if ([']', ')', '}'].includes(c)) {
      // Found a closing brace, pop the stack
      const lastBrace = braceStack.pop();
      if (lastBrace === undefined) {
        throw new Error(`Invalid validation rule ID '${id}'. Unmatched closing brace '${c}' at position ${i}.`);
      }
      if ((lastBrace === '(' && c !== ')') || (lastBrace === '[' && c !== ']') || (lastBrace === '{' && c !== '}')) {
        throw new Error(`Invalid validation rule ID '${id}'. Mismatched closing brace '${c}' at position ${i}. Expected '${lastBrace === '(' ? ')' : lastBrace === '[' ? ']' : '}'}'.`);
      }
    } else if (['[', '(', '{'].includes(c)) {
      // Found an opening brace, push it onto the stack
      braceStack.push(c);
    }
  }

  // Handle result
  if (nsSeparator === undefined) {
    return { ruleId: id };
  }

  if (nsSeparator === 0) {
    throw new Error(`Invalid validation rule ID '${id}'. Missing plugin name before '::'.`);
  }

  const namespace = namespaceFromString(id.substring(0, nsSeparator));
  const ruleId = id.substring(nsSeparator + 2);

  return { namespace, ruleId };
}

/**
 * Normalize the given validation ID to a fully qualified ID, using the `annotation` namespace if no namespace is provided.
 */
export function normalizeValidationId(id: string | ValidationId, defaultNamespace: Namespace): string {
  const p = typeof id === 'string' ? parseValidationId(id) : id;

  const parsed = {
    namespace: p.namespace ? namespaceFromString(p.namespace[NS].replaceAll(/ /g, '-')) : undefined,
    ruleId: p.ruleId.replaceAll(/ /g, '-'),
  };

  // Allow aliases for this namespace, but normalize it to the actual namespace we settled on.
  if (parsed.namespace && ['annotation', 'Construct-Annotations'].includes(parsed.namespace[NS])) {
    return `${ANNOTATION_PLUGIN_NAMESPACE}::${parsed.ruleId}`;
  }

  return `${parsed.namespace ?? defaultNamespace[NS]}::${parsed.ruleId}`;
}

/**
 * Normalize the given validation ID to a fully qualified ID, using the `Annotation` namespace if no namespace is provided.
 */
export function normalizeValidationIdForAnnotations(id: string | ValidationId): string {
  return normalizeValidationId(id, ANNOTATION_PLUGIN_NAMESPACE);
}

const NS = Symbol('namespace');

export interface Namespace {
  [NS]: string;
}

/**
 * Convert a plugin name to a namespace for validation IDs.
 */
export function namespaceFromPluginName(pluginName: string): Namespace {
  if (pluginName === ANNOTATION_PLUGIN_NAME) {
    return ANNOTATION_PLUGIN_NAMESPACE as Namespace;
  }

  return namespaceFromString(pluginName.replace(/ /g, '-'));
}

function namespaceFromString(namespace: string): Namespace {
  return Object.assign({
    [NS]: namespace.replace(/ /g, '-'),
  }, {
    toString(this: Namespace): string {
      return this[NS];
    },
  });
}

/**
 * Convert a namespace to a displayable plugin name
 */
export function pluginNameFromNamespace(namespace: Namespace): string {
  // We do not convert the annotation namespace back to its legacy plugin name.
  return namespace[NS].replace(/-/g, ' ');
}

export const ANNOTATION_PLUGIN_NAME = 'Construct Annotations';
export const ANNOTATION_PLUGIN_NAMESPACE = namespaceFromPluginName('Annotation');
