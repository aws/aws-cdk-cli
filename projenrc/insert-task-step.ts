import { Component, Project, TaskStep } from 'projen';

export interface InsertTaskStepProps {
  readonly taskName: string;
  readonly insertSteps: TaskStep[];
  readonly beforeExec: string;
}

export class InsertTaskStep extends Component {
  constructor(project: Project, private props: InsertTaskStepProps) {
    super(project);
  }

  preSynthesize() {
    const task = this.project.tasks.tryFind(this.props.taskName);
    if (!task) {
      throw new Error(`Did not find task ${this.props.taskName}`);
    }

    // Find the bump task, and do the CLI version copy straight after
    const stepIx = task.steps.findIndex(s => s.exec === this.props.beforeExec);
    if (stepIx === -1) {
      throw new Error(`Did not find step: ${this.props.beforeExec}`);
    }

    // Accessing internals like a dirty boi
    (task as any)._steps.splice(stepIx, 0, ...this.props.insertSteps);
  }
}
