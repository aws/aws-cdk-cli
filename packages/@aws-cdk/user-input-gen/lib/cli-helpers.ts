import type { IScope } from '@cdklabs/typewriter';
import { ExternalModule, $E, ThingSymbol, expr } from '@cdklabs/typewriter';

export class CliHelpers extends ExternalModule {
  public readonly browserForPlatform = makeCallableExpr(this, 'browserForPlatform');
  public readonly cliVersion = makeCallableExpr(this, 'cliVersion');
  public readonly isCI = makeCallableExpr(this, 'isCI');
  public readonly shouldDisplayNotices = makeCallableExpr(this, 'shouldDisplayNotices');
  public readonly yargsNegativeAlias = makeCallableExpr(this, 'yargsNegativeAlias');
}

function makeCallableExpr(scope: IScope, name: string) {
  return $E(expr.sym(new ThingSymbol(name, scope)));
}
