
import type { Monorepo } from 'cdklabs-projen-project-types/lib/yarn';
import { Component } from 'projen';

/**
 * Check package duplication for the @aws-sdk and @smithy packages.
 */
export class CheckSdkDuplication extends Component {
  constructor(project: Monorepo) {
    super(project);

    for (const taskName of ['build']) {
      this.project.tasks.tryFind(taskName)?.exec('tsx projenrc/check-sdk-duplication.task.ts');
    }

    // TODO: Dhyan had some concerns around `yarn dedupe`. But if it works, we should have this component
    // automatically insert that command into the `post-upgrade` task.
  }
}
