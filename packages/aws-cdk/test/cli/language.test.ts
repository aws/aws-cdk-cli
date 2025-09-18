import { getLanguageAlias, getLanguageFromAlias } from '../../lib/commands/language';

describe('should get language alias from language name or alias', () => {
  test.each([
    ['csharp', 'cs'],
    ['cs', 'cs'],
    ['fsharp', 'fs'],
    ['fs', 'fs'],
    ['go', 'go'],
    ['java', 'java'],
    ['javascript', 'js'],
    ['js', 'js'],
    ['python', 'py'],
    ['py', 'py'],
    ['typescript', 'ts'],
    ['ts', 'ts'],
  ])('getLanguageAlias(%s) should return %s', (input, expected) => {
    expect(getLanguageAlias(input)).toBe(expected);
  });

  test('when unsupported language is specified, return undefined', () => {
    expect(getLanguageAlias('ruby')).toBeUndefined();
  });
});

describe('should get language name from language alias or name', () => {
  test.each([
    ['csharp', 'csharp'],
    ['cs', 'csharp'],
    ['fsharp', 'fsharp'],
    ['fs', 'fsharp'],
    ['go', 'go'],
    ['java', 'java'],
    ['javascript', 'javascript'],
    ['js', 'javascript'],
    ['python', 'python'],
    ['py', 'python'],
    ['typescript', 'typescript'],
    ['ts', 'typescript'],
  ])('getLanguageFromAlias(%s) should return %s', (input, expected) => {
    expect(getLanguageFromAlias(input)).toBe(expected);
  });

  test('when unsupported language alias is specified, return undefined', () => {
    expect(getLanguageFromAlias('ruby')).toBeUndefined();
  });
});
