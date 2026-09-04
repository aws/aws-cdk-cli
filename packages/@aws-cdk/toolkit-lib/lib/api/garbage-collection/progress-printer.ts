import chalk from 'chalk';
import type { GcAction, GcAsset as GCAsset } from './garbage-collector';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { IoHelper } from '../io/private';

export class ProgressPrinter {
  private ioHelper: IoHelper;
  private totalAssets: number;
  private assetsScanned: number;
  private taggedAsset: number;
  private taggedAssetsSizeMb: number;
  private deletedAssets: number;
  private deletedAssetsSizeMb: number;
  private eligibleAssets: number;
  private eligibleAssetsSizeMb: number;
  private action: GcAction;
  private interval: number;
  private setInterval?: ReturnType<typeof setTimeout>;
  private isPaused: boolean;

  constructor(ioHelper: IoHelper, totalAssets: number, interval?: number, action: GcAction = 'full') {
    this.ioHelper = ioHelper;
    this.totalAssets = totalAssets;
    this.assetsScanned = 0;
    this.taggedAsset = 0;
    this.taggedAssetsSizeMb = 0;
    this.deletedAssets = 0;
    this.deletedAssetsSizeMb = 0;
    this.eligibleAssets = 0;
    this.eligibleAssetsSizeMb = 0;
    this.action = action;
    this.interval = interval ?? 10_000;
    this.isPaused = false;
  }

  public reportScannedAsset(amt: number) {
    this.assetsScanned += amt;
  }

  /**
   * Report assets that are eligible for garbage collection (i.e. isolated assets
   * that are not referenced by any deployed stack). Used by the `print` action,
   * which does not tag or delete anything, so that the output reflects what gc
   * found instead of always reporting 0 assets.
   */
  public reportEligibleAsset(assets: GCAsset[]) {
    this.eligibleAssets += assets.length;
    const sizeInBytes = assets.reduce((total, asset) => total + asset.size, 0);
    this.eligibleAssetsSizeMb += sizeInBytes / 1_048_576;
  }

  public reportTaggedAsset(assets: GCAsset[]) {
    this.taggedAsset += assets.length;
    const sizeInBytes = assets.reduce((total, asset) => total + asset.size, 0);
    this.taggedAssetsSizeMb += sizeInBytes / 1_048_576;
  }

  public reportDeletedAsset(assets: GCAsset[]) {
    this.deletedAssets += assets.length;
    const sizeInBytes = assets.reduce((total, asset) => total + asset.size, 0);
    this.deletedAssetsSizeMb += sizeInBytes / 1_048_576;
  }

  public start() {
    // If there is already a running setInterval, throw an error.
    // This is because if this.setInterval is reassigned to another setInterval,
    // the original setInterval remains and can no longer be cleared.
    if (this.setInterval) {
      throw new ToolkitError('PrinterAlreadyRunning', 'ProgressPrinter is already running. Stop it first using the stop() method before starting it again.');
    }

    this.setInterval = setInterval(() => {
      if (!this.isPaused) {
        this.print();
      }
    }, this.interval);
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
  }

  public stop() {
    clearInterval(this.setInterval);
    // print one last time if not paused
    if (!this.isPaused) {
      this.print();
    }
  }

  private print() {
    // Guard against dividing by zero: an empty bucket/repo (or the final flush of one)
    // has totalAssets === 0, which would produce "NaN%" and make gc look broken (#625).
    const percentage = this.totalAssets > 0
      ? ((this.assetsScanned / this.totalAssets) * 100).toFixed(2)
      : '100.00';

    // The 'print' action does not tag or delete anything, so report the assets that
    // are eligible for garbage collection rather than always reporting "0 tagged, 0 deleted".
    if (this.action === 'print') {
      if (this.eligibleAssetsSizeMb >= 1000) {
        void this.ioHelper.defaults.info(chalk.green(`[${percentage}%] ${this.assetsScanned} files scanned: ${this.eligibleAssets} assets (${(this.eligibleAssetsSizeMb / 1000).toFixed(2)} GiB) eligible for deletion.`));
      } else {
        void this.ioHelper.defaults.info(chalk.green(`[${percentage}%] ${this.assetsScanned} files scanned: ${this.eligibleAssets} assets (${this.eligibleAssetsSizeMb.toFixed(2)} MiB) eligible for deletion.`));
      }
      return;
    }

    // print in MiB until we hit at least 1 GiB of data tagged/deleted
    if (Math.max(this.taggedAssetsSizeMb, this.deletedAssetsSizeMb) >= 1000) {
      void this.ioHelper.defaults.info(chalk.green(`[${percentage}%] ${this.assetsScanned} files scanned: ${this.taggedAsset} assets (${(this.taggedAssetsSizeMb / 1000).toFixed(2)} GiB) tagged, ${this.deletedAssets} assets (${(this.deletedAssetsSizeMb / 1000).toFixed(2)} GiB) deleted.`));
    } else {
      void this.ioHelper.defaults.info(chalk.green(`[${percentage}%] ${this.assetsScanned} files scanned: ${this.taggedAsset} assets (${this.taggedAssetsSizeMb.toFixed(2)} MiB) tagged, ${this.deletedAssets} assets (${this.deletedAssetsSizeMb.toFixed(2)} MiB) deleted.`));
    }
  }
}
