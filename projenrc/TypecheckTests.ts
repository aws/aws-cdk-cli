import type { TypeScriptWorkspace } from 'cdklabs-projen-project-types/lib/yarn';
import { Component } from 'projen';

/**
 * Enable type checking for the test of the given project
 */
export class TypecheckTests extends Component {
  constructor(ws: TypeScriptWorkspace) {
    super(ws);

    // Also type-check tests
    ws.compileTask.exec('tsc --build test');
  }
}
