import bestPractices from './best-practices';
import constructs from './constructs';
import formatting from './formatting';
import imports from './imports';
import jest from './jest';
import jsdoc from './jsdoc';
import team from './team';

export const ESLINT_RULES = {
  ...team,
  ...bestPractices,
  ...constructs,
  ...imports,
  ...formatting,
  ...jsdoc,
  ...jest,
};
