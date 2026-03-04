import { ToolkitError } from '../../lib/toolkit/toolkit-error';
import { rangeFromSemver } from '../../lib/util/version-range';

describe('rangeFromSemver', () => {
  describe('bracket format', () => {
    describe('exact versions (no prefix)', () => {
      test('basic semver versions', () => {
        expect(rangeFromSemver('1.2.3', 'bracket')).toEqual('1.2.3');
        expect(rangeFromSemver('0.0.1', 'bracket')).toEqual('0.0.1');
        expect(rangeFromSemver('10.20.30', 'bracket')).toEqual('10.20.30');
      });

      test('versions with pre-release identifiers', () => {
        expect(rangeFromSemver('1.2.3-alpha', 'bracket')).toEqual('1.2.3-alpha');
        expect(rangeFromSemver('2.0.0-beta.1', 'bracket')).toEqual('2.0.0-beta.1');
        expect(rangeFromSemver('1.0.0-rc.1+build.1', 'bracket')).toEqual('1.0.0-rc.1+build.1');
      });

      test('versions with build metadata', () => {
        expect(rangeFromSemver('1.2.3+build.1', 'bracket')).toEqual('1.2.3+build.1');
        expect(rangeFromSemver('1.0.0+20130313144700', 'bracket')).toEqual('1.0.0+20130313144700');
      });
    });

    describe('caret ranges (^)', () => {
      test('basic caret ranges', () => {
        expect(rangeFromSemver('^1.2.3', 'bracket')).toEqual('[1.2.3,2.0.0)');
        expect(rangeFromSemver('^0.2.3', 'bracket')).toEqual('[0.2.3,1.0.0)');
        expect(rangeFromSemver('^10.5.2', 'bracket')).toEqual('[10.5.2,11.0.0)');
      });

      test('caret ranges with zero major version', () => {
        expect(rangeFromSemver('^0.0.1', 'bracket')).toEqual('[0.0.1,1.0.0)');
        expect(rangeFromSemver('^0.1.0', 'bracket')).toEqual('[0.1.0,1.0.0)');
      });

      test('caret ranges with large version numbers', () => {
        expect(rangeFromSemver('^999.888.777', 'bracket')).toEqual('[999.888.777,1000.0.0)');
      });
    });
  });

  describe('pep format', () => {
    describe('exact versions (no prefix)', () => {
      test('basic semver versions', () => {
        expect(rangeFromSemver('1.2.3', 'pep')).toEqual('==1.2.3');
        expect(rangeFromSemver('0.0.1', 'pep')).toEqual('==0.0.1');
        expect(rangeFromSemver('10.20.30', 'pep')).toEqual('==10.20.30');
      });

      test('versions with pre-release identifiers', () => {
        expect(rangeFromSemver('1.2.3-alpha', 'pep')).toEqual('==1.2.3-alpha');
        expect(rangeFromSemver('2.0.0-beta.1', 'pep')).toEqual('==2.0.0-beta.1');
        expect(rangeFromSemver('1.0.0-rc.1+build.1', 'pep')).toEqual('==1.0.0-rc.1+build.1');
      });

      test('versions with build metadata', () => {
        expect(rangeFromSemver('1.2.3+build.1', 'pep')).toEqual('==1.2.3+build.1');
        expect(rangeFromSemver('1.0.0+20130313144700', 'pep')).toEqual('==1.0.0+20130313144700');
      });
    });

    describe('caret ranges (^)', () => {
      test('basic caret ranges', () => {
        expect(rangeFromSemver('^1.2.3', 'pep')).toEqual('>=1.2.3,<2.0.0');
        expect(rangeFromSemver('^0.2.3', 'pep')).toEqual('>=0.2.3,<1.0.0');
        expect(rangeFromSemver('^10.5.2', 'pep')).toEqual('>=10.5.2,<11.0.0');
      });

      test('caret ranges with zero major version', () => {
        expect(rangeFromSemver('^0.0.1', 'pep')).toEqual('>=0.0.1,<1.0.0');
        expect(rangeFromSemver('^0.1.0', 'pep')).toEqual('>=0.1.0,<1.0.0');
      });

      test('caret ranges with large version numbers', () => {
        expect(rangeFromSemver('^999.888.777', 'pep')).toEqual('>=999.888.777,<1000.0.0');
      });
    });
  });

  describe('error handling', () => {
    describe('invalid semver versions', () => {
      test('incomplete version numbers', () => {
        expect(() => rangeFromSemver('1.2', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1', 'pep')).toThrow(ToolkitError);
      });

      test('invalid version formats', () => {
        expect(() => rangeFromSemver('1.2.3.4', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('v1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2.3.4', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('v1.2.3', 'pep')).toThrow(ToolkitError);
      });

      test('non-numeric version parts', () => {
        expect(() => rangeFromSemver('a.b.c', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.b.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('a.b.c', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.b.3', 'pep')).toThrow(ToolkitError);
      });

      test('empty or whitespace strings', () => {
        expect(() => rangeFromSemver('', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver(' ', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver(' ', 'pep')).toThrow(ToolkitError);
      });
    });

    describe('unsupported range prefixes', () => {
      test('tilde ranges (~)', () => {
        expect(() => rangeFromSemver('~1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('~1.2.3', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('~0.1.0', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('~0.1.0', 'pep')).toThrow(ToolkitError);
      });

      test('comparison operators', () => {
        expect(() => rangeFromSemver('>1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('>=1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('<1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('<=1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('>1.2.3', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('>=1.2.3', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('<1.2.3', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('<=1.2.3', 'pep')).toThrow(ToolkitError);
      });

      test('wildcard patterns', () => {
        expect(() => rangeFromSemver('1.*', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2.*', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('*', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.*', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2.*', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('*', 'pep')).toThrow(ToolkitError);
      });

      test('hyphen ranges', () => {
        expect(() => rangeFromSemver('1.2.3 - 2.3.4', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2.3 - 2.3.4', 'pep')).toThrow(ToolkitError);
      });

      test('x-ranges', () => {
        expect(() => rangeFromSemver('1.2.x', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.x.x', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.2.x', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('1.x.x', 'pep')).toThrow(ToolkitError);
      });

      test('multiple operators', () => {
        expect(() => rangeFromSemver('^^1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('~^1.2.3', 'bracket')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('^^1.2.3', 'pep')).toThrow(ToolkitError);
        expect(() => rangeFromSemver('~^1.2.3', 'pep')).toThrow(ToolkitError);
      });
    });

    test('error message content', () => {
      expect(() => rangeFromSemver('1.2', 'bracket')).toThrow('not a semver or unsupported range syntax');
      expect(() => rangeFromSemver('~1.2.3', 'bracket')).toThrow('unsupported range syntax - ~');
      expect(() => rangeFromSemver('>1.2.3', 'pep')).toThrow('unsupported range syntax - >');
    });
  });

  describe('edge cases', () => {
    test('versions with leading/trailing whitespace', () => {
      expect(() => rangeFromSemver(' 1.2.3', 'bracket')).toThrow(ToolkitError);
      expect(() => rangeFromSemver('1.2.3 ', 'bracket')).toThrow(ToolkitError);
      expect(() => rangeFromSemver(' ^1.2.3', 'bracket')).toThrow(ToolkitError);
    });

    test('versions with unusual but valid semver formats', () => {
      expect(rangeFromSemver('1.2.3-alpha.1.2.3', 'bracket')).toEqual('1.2.3-alpha.1.2.3');
      expect(rangeFromSemver('^1.2.3-alpha.1.2.3', 'bracket')).toEqual('[1.2.3,2.0.0)');
      expect(rangeFromSemver('1.2.3-alpha.1.2.3', 'pep')).toEqual('==1.2.3-alpha.1.2.3');
      expect(rangeFromSemver('^1.2.3-alpha.1.2.3', 'pep')).toEqual('>=1.2.3,<2.0.0');
    });

    test('maximum version numbers', () => {
      expect(rangeFromSemver('^999999.999999.999999', 'bracket')).toEqual('[999999.999999.999999,1000000.0.0)');
      expect(rangeFromSemver('^999999.999999.999999', 'pep')).toEqual('>=999999.999999.999999,<1000000.0.0');
    });
  });
});
