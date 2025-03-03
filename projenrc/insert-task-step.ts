import { Component, Project, TaskStep } from "projen";

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
    const releaseTask = this.project.tasks.tryFind(this.props.taskName);
    if (!releaseTask) {
      throw new Error(`Did not find task ${this.props.taskName}`);
    }

    // Find the bump task, and do the CLI version copy straight after
    const bumpIx = releaseTask.steps.findIndex(s => s.exec === this.props.beforeExec)
    if (bumpIx === -1) {
      throw new Error(`Did not find step: ${this.props.beforeExec}`);
    }

    releaseTask.steps.splice(bumpIx, 0, ...this.props.insertSteps);
  }
}