import type { IConstruct, IMixin } from 'constructs';
import { javascript } from 'projen';

export class YarnVersion implements IMixin {
  public constructor(private readonly version: string) {
  }

  public supports(construct: IConstruct): construct is javascript.NodePackage {
    return construct instanceof javascript.NodePackage;
  }

  public applyTo(construct: IConstruct): void {
    if (!this.supports(construct)) {
      return;
    }

    construct.addField('packageManager', `yarn@${this.version}`);
  }
}
