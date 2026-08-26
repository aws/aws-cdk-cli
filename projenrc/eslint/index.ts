import { yarn } from 'cdklabs-projen-project-types';
import type { typescript } from 'projen';
import bestPractices from './best-practices';
import constructs from './constructs';
import formatting from './formatting';
import imports from './imports';
import jest from './jest';
import jsdoc from './jsdoc';
import team from './team';

const ESLINT_RULES = {
  ...team,
  ...bestPractices,
  ...constructs,
  ...imports,
  ...formatting,
  ...jsdoc,
  ...jest,

  // Prettier needs to be turned off for now, there's too much code that doesn't conform to it
  'prettier/prettier': ['off'],
};

/**
 * Projen depends on TypeScript-eslint 7 by default.
 *
 * We want 8 for the parser, and 6 for the plugin (because after 6 some linter
 * rules we are relying on have been moved to another plugin).
 *
 * Also configure eslint plugins & rules, which cannot be configured by props.
 */
export function configureEslint(x: typescript.TypeScriptProject) {
  const isRoot = x instanceof yarn.Monorepo;
  const isPrivate = x instanceof yarn.TypeScriptWorkspace && x.isPrivatePackage;

  // configure deps and plugins
  x.addDevDeps(
    '@typescript-eslint/eslint-plugin@^8',
    '@typescript-eslint/parser@^8',
    '@stylistic/eslint-plugin@^3',
    '@cdklabs/eslint-plugin',
    'eslint-plugin-import',
    'eslint-plugin-jest',
    'eslint-plugin-jsdoc',
  );
  x.eslint?.addPlugins(
    '@typescript-eslint',
    'import',
    '@cdklabs',
    '@stylistic',
    'jest',
    'jsdoc',
  );

  // ignore files
  x.eslint?.addIgnorePattern('*.generated.ts');

  // base rules from plugins and our sets
  x.eslint?.addExtends(
    'plugin:jest/recommended',
  );
  x.eslint?.addRules(ESLINT_RULES);

  // The `child_process` / `shell: true` bans protect SHIPPED code from spawning
  // outside the subprocess tool. Two categories are outside that trust boundary
  // and are exempt:
  //   - test code, which legitimately imports `child_process` to mock/spy and
  //     may spawn with `shell: true` against throwaway fixtures;
  //   - build-time tooling (projen config, build tasks), which runs on
  //     developer/CI machines rather than a user's machine.
  // (This also relaxes the md5/punycode rules for these files, which is harmless
  // for non-shipped code.)
  x.eslint?.addOverride({
    files: [
      '**/test/**',
      '**/tests/**',
      '**/*.test.ts',
      '**/*.integtest.ts',
      'projenrc/**',
      '**/projenrc/**',
      '.projenrc.ts',
      '**/.projenrc.ts',
    ],
    rules: {
      'no-restricted-imports': ['off'],
      'no-restricted-syntax': ['off'],
    },
  });

  // For our published packages, we need all type imports to be from a public dependency
  if (!isRoot && !isPrivate && x.eslint) {
    x.eslint.rules['import/no-extraneous-dependencies'][1].includeTypes = true;
  }
}
