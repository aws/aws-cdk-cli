import {
  ANNOTATION_PLUGIN_NAME,
  ANNOTATION_PLUGIN_NAMESPACE,
  isSuppressibleViolation,
  namespaceFromPluginName,
  normalizeValidationId,
  normalizeValidationIdForAnnotations,
  parseValidationId,
  pluginNameFromNamespace,
} from '../../lib/validation/parsing';

describe('parseValidationId', () => {
  test('a bare id has no namespace', () => {
    expect(parseValidationId('MyRule')).toEqual({ ruleId: 'MyRule' });
  });

  test('splits a namespace off on the first ::', () => {
    const parsed = parseValidationId('my-plugin::MyRule');

    expect(parsed.ruleId).toBe('MyRule');
    expect(String(parsed.namespace)).toBe('my-plugin');
  });

  test('normalizes spaces in the namespace to dashes', () => {
    expect(String(parseValidationId('My Plugin::MyRule').namespace)).toBe('My-Plugin');
  });

  test('ignores :: nested inside brackets', () => {
    // Brackets let a rule id carry a qualified name without being split.
    expect(parseValidationId('[cdk::nag]')).toEqual({ ruleId: '[cdk::nag]' });
    expect(parseValidationId('plugin::Rule[a::b]')).toMatchObject({ ruleId: 'Rule[a::b]' });
  });

  test.each([
    ['a second delimiter', 'a::b::c', /delimiter is reserved/],
    ['a missing plugin name', '::MyRule', /Missing plugin name/],
    ['an unmatched closing brace', 'MyRule]', /Unmatched closing brace/],
    ['a mismatched closing brace', 'MyRule[a)', /Mismatched closing brace/],
  ])('rejects %s', (_what, id, message) => {
    expect(() => parseValidationId(id)).toThrow(message);
  });
});

describe('normalizeValidationId', () => {
  const defaultNs = namespaceFromPluginName('fallback-plugin');

  test('qualifies a bare id with the default namespace', () => {
    expect(normalizeValidationId('MyRule', defaultNs)).toBe('fallback-plugin::MyRule');
  });

  test('keeps an explicit namespace', () => {
    expect(normalizeValidationId('other-plugin::MyRule', defaultNs)).toBe('other-plugin::MyRule');
  });

  test('replaces spaces on both sides of the delimiter', () => {
    expect(normalizeValidationId('My Plugin::My Rule', defaultNs)).toBe('My-Plugin::My-Rule');
  });

  test.each(['annotation', 'Construct-Annotations', 'Construct Annotations'])(
    'folds the %s alias onto the canonical annotation namespace',
    (alias) => {
      expect(normalizeValidationId(`${alias}::MyRule`, defaultNs)).toBe('Annotation::MyRule');
    },
  );

  test('accepts an already-parsed id', () => {
    expect(normalizeValidationId(parseValidationId('p::R'), defaultNs)).toBe('p::R');
  });

  test('normalizeValidationIdForAnnotations defaults to the annotation namespace', () => {
    expect(normalizeValidationIdForAnnotations('MyRule')).toBe('Annotation::MyRule');
    // An explicit namespace still wins over the default.
    expect(normalizeValidationIdForAnnotations('p::MyRule')).toBe('p::MyRule');
  });
});

describe('namespaces', () => {
  test('the legacy annotation plugin name maps to the canonical namespace', () => {
    expect(String(namespaceFromPluginName(ANNOTATION_PLUGIN_NAME))).toBe(String(ANNOTATION_PLUGIN_NAMESPACE));
    expect(String(ANNOTATION_PLUGIN_NAMESPACE)).toBe('Annotation');
  });

  test('a plugin name round-trips through its namespace', () => {
    expect(pluginNameFromNamespace(namespaceFromPluginName('My Plugin'))).toBe('My Plugin');
  });
});

describe('isSuppressibleViolation', () => {
  test.each([
    ['a plain error', { severity: 'error' }, true],
    ['a warning', { severity: 'warning' }, true],
    ['no severity at all', {}, true],
    ['a warning annotation', { severity: 'warning', ruleMetadata: { 'cdk:annotation': 'true' } }, true],
    // Fatal findings and error-level annotations are the two things a user may not wave away.
    ['a fatal violation', { severity: 'fatal' }, false],
    ['a fatal violation in any casing', { severity: 'FATAL' }, false],
    ['an error annotation', { severity: 'error', ruleMetadata: { 'cdk:annotation': 'true' } }, false],
  ])('%s -> %s', (_what, violation, expected) => {
    expect(isSuppressibleViolation(violation)).toBe(expected);
  });
});
