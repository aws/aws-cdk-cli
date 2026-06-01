# 1. Per-Project Synth Daemon

Date: 2026-05-27

## Status

Proposed

## Context

An editor LSP and a `cdk explore` web server may observe the same
CDK project simultaneously. Both need a consistent, fresh view of
`cdk.out/` after file saves, and synthesis is not instantaneous.

Without coordination, two problems emerge:

1. **Wasted compute.** Each client independently triggers synth on
   every save. With N clients, a single save produces N redundant
   synth operations. With frequent saves, an unbounded fraction of
   wall-clock time is spent synthesizing.
2. **Stale divergence.** A synth started at T1 completes at T3, but
   the user saved again at T2. The result is internally consistent
   but does not reflect the latest source. For an LSP, stale
   diagnostics are worse than no diagnostics — they lead the
   developer to fix problems that no longer exist or miss problems
   that do.

### Options considered

#### Option A: No coordination

Each client triggers its own synth independently. The last one to
finish wins. This is the simplest approach.

Problems:

- N clients × M saves = N×M synth operations. A user with an LSP
  and a web server open gets 2 synths per save. With rapid saves
  during a refactor, both processes spend 100% of their time
  synthesizing.
- No client knows whether its `cdk.out/` is fresh. Each must either
  poll the filesystem or re-synth speculatively.
- Concurrent writes to `cdk.out/` from two simultaneous synths could
  produce inconsistent output.

#### Option B: Directory locking (flock on `cdk.out/`)

Processes compete for a write lock on `cdk.out/`. Winner synthesizes,
losers wait and read. This prevents concurrent writes but creates a
dilemma:

- *If losers synth unconditionally after acquiring the lock
  ("optimistic"):* This is wasted compute — each client re-synths
  the same source state another client just finished synthesizing.
  With 3 clients and frequent saves, the system may spend near 100%
  of wall-clock time synthesizing. Since there is no method to
  broadcast, only the last client to finish has fresh data; the
  others are already stale by the time they complete.

![Optimistic Flock](optimistic-flock.png)

- *If losers skip synth and just read ("pessimistic"):* This is
  stale divergence — a save occurred of version 2 while the winner
  was synthesizing from version 1. The winner finishes and writes
  version 1 data. The losers read it and assume it's fresh, but it
  doesn't reflect version 2. Synth time is managed, but all clients
  show stale data with no mechanism to detect it, and no re-synth
  is triggered.

![Pessimistic Flock](pessimistic-flock.png)

Additionally, flock on `cdk.out/` interferes with normal
`cdk synth` — the user's manual synth would either block on the
lock (unacceptable) or bypass it entirely (reintroduces all the
problems locking was intended to solve).

#### Option C: Per-project synth daemon (proposed)

A single background process accepts synth requests from all clients,
coalesces them via a queue-of-one latch, synthesizes once, and
broadcasts the result to all subscribers. Cost is bounded while
consistency and eventual freshness is guaranteed.

![Daemon Solution](daemon-solution.png)

## Decision

A per-project daemon coordinates background synthesis.

![Daemon Architecture](daemon-architecture.png)

**What it solves:**

The daemon coalesces all synth requests that arrive during an
in-flight synth into exactly one re-synth afterward. At most one
synth runs and one is pending, regardless of how many saves or
clients arrive. This guarantees convergence to the latest source
state without unbounded cost.

All connected clients receive a `synthComplete`/`synthFailed`
broadcast when synthesis finishes.

**What it does NOT do:**

- Does not interfere with `cdk synth` or `cdk deploy`. Interactive
  CLI commands never go through the daemon — they are too critical
  to depend on another process.
- Does not watch files. Clients decide when to request synth.
- Does not lock `cdk.out/`. A user running `cdk synth` in their
  terminal is never blocked or interfered with by the daemon.

**Why now, not later:**

- Multi-client is a day-1 scenario: the editor LSP and
  `cdk explore` web server both trigger synth on the same project
  from the start.
- An LSP serving stale data is useless. Freshness must be solved
  before building diagnostic features on top.
- Unbounded synth cost from uncoordinated clients is unacceptable
  for a background tool.

**Lifecycle:**

- Started by: first client that calls `acquireDaemon(projectDir)`
  (attempts connection, spawns if absent)
- Discovered by: deterministic socket path derived from project
  directory (`/tmp/cdk-synth-<sha256>.sock`)
- Shut down by: idle timeout (5 min with zero subscribers),
  protocol version mismatch, SIGTERM
- Singleton enforced by: exclusive lock file during spawn,
  deterministic socket path

**CDK app stdout/stderr:**

The daemon implements `IIoHost` from `@aws-cdk/toolkit-lib`. All
CDK app output during synthesis arrives as structured `IoMessage`
objects via `notify()`. Nothing is silently lost.

- **Synth failures:** broadcast to all clients as `synthFailed`
  with error text. Clients surface this in the editor or
  explorer UI.
- **App `console.log` output:** routed to the editor's Output
  channel via LSP `window/logMessage`. Users who need interactive
  stdout run `cdk synth` directly, which bypasses the daemon.
- **Daemon operational messages:** written to a log file at
  `<socketPath>.log`.

**Terminal attachment (TTY):**

Not a concern. The CDK app is always spawned with piped stdio by
`execInChildProcess` in toolkit-lib — `process.stdout.isTTY` is
`false` regardless of whether the caller is the CLI, CI, or the
daemon. The daemon does not change the app's TTY status.

**Failure modes:**

| Failure                        | Recovery                                    |
| ------------------------------ | ------------------------------------------- |
| Daemon crashes mid-synth       | Client detects socket close, respawns       |
| Concurrent spawn race          | Exclusive lock file; loser re-checks socket |
| Synth hangs                    | 5-min timeout → `synthFailed` broadcast     |
| CLI upgrade (version mismatch) | Handshake detects → old daemon shuts down   |
| Stale socket from unclean exit | PID liveness check → cleanup and respawn    |

**Torn reads:**

`cdk.out/` is written non-atomically — multiple files are written
sequentially during synthesis. This is a pre-existing property of
`cdk synth`, not something the daemon introduces. Today it is not a
problem because nothing reads `cdk.out/` while it's being written.
You run synth, it finishes, then you look at the output.

The daemon does not change this risk. When the daemon triggers synth,
clients wait for `synthComplete` before re-reading, which naturally
avoids the race. The torn-read window only exists when an external
process (manual `cdk synth`, `cdk watch`) writes to `cdk.out/` while
clients happen to be reading — the same situation that exists today.
The file-write phase is fast (milliseconds), so the window is tiny
in practice.

## Consequences

**Positive:**

- Bounded synth cost with guaranteed freshness
- N clients share one synth — no wasted compute
- Broadcast eliminates polling and filesystem-watch races

**Negative:**

- Additional background process to manage (spawn, health-check,
  version handshake)
- CDK app `console.log` only visible in editor Output channel
  during background synth
- New failure modes (crash recovery, stale sockets, spawn races)

**Assumptions that would invalidate this:**

- If most users only ever run a single client, the coordination
  overhead is unnecessary.
- If synth becomes fast enough (<1s) that redundant synths are
  cheap, the coalescing benefit vanishes.
