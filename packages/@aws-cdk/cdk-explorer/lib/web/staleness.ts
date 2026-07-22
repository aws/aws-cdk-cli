/**
 * Tracks whether an open source file is out of date relative to the cloud
 * assembly the explorer is currently showing.
 *
 * A file is stale when it was modified after the synth that produced the current
 * assembly *started*, not merely after it finished. An edit made while a synth
 * was in flight may not have been picked up by that synth, so its squiggles and
 * navigation anchors can already be wrong; treating "modified after synth start"
 * as stale catches that race.
 *
 * The reference timestamp for a generation is the moment synth write-lock
 * activity (`synth.lock`) was first observed since the last refresh. If none was
 * observed (the synth predated the server, or the lock was too brief to catch),
 * it falls back to the assembly manifest's mtime, i.e. synth-finish time. This
 * is a best-effort heuristic: at worst a squiggle sits on the wrong line until
 * the next synth, which is acceptable.
 */
export class StalenessTracker {
  /** Reference for the loaded generation; undefined until the first assembly read. */
  private reference: number | undefined;

  /** Earliest synth-activity timestamp seen since the last assembly refresh. */
  private synthActivitySince: number | undefined;

  /** Record synth write-lock activity (a synth started). Earliest since last refresh wins. */
  public noteSynthActivity(atMs: number): void {
    if (this.synthActivitySince === undefined) {
      this.synthActivitySince = atMs;
    }
  }

  /**
   * Freeze the staleness reference for a newly loaded assembly generation.
   * Prefers the observed synth start; falls back to the manifest mtime.
   */
  public onAssemblyRefreshed(manifestMtimeMs: number): void {
    this.reference = this.synthActivitySince ?? manifestMtimeMs;
    this.synthActivitySince = undefined;
  }

  /** True when a file last modified at `fileMtimeMs` is newer than the current reference. */
  public isStale(fileMtimeMs: number): boolean {
    return this.reference !== undefined && fileMtimeMs > this.reference;
  }
}
