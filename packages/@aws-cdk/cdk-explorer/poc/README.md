# stdout/TTY POC — Findings

## Key Discovery

The CDK app's stdout/stderr is **already fully captured** by the toolkit's `IIoHost` interface.
No output is lost. No special handling is needed.

### How it works

1. `toolkit.synth()` calls `execInChildProcess()` (in `exec.ts`)
2. The child process is spawned with `stdio: ['ignore', 'pipe', 'pipe']` — **the CDK app NEVER has a TTY**, regardless of whether the caller has one
3. App stdout lines → `eventPublisher('data_stdout', line)` → `ioHelper.notify(IO.CDK_ASSEMBLY_I1001.msg(line))`
4. App stderr lines → `eventPublisher('data_stderr', line)` → `ioHelper.notify(IO.CDK_ASSEMBLY_E1002.msg(line))`
5. ALL output arrives at the `IIoHost.notify()` method as structured `IoMessage` objects

### Implications for the daemon

- **TTY concern is a non-issue.** The CDK app is always piped, never TTY-attached, even when you run `cdk synth` from a terminal. The app's `process.stdout.isTTY` is always `false`. The daemon doesn't change this.
- **stdout/stderr concern is a non-issue.** The daemon implements `IIoHost`. It receives ALL app output as structured messages. It can:
  - Log them to file (current behavior)
  - Broadcast them to subscribers over the socket (future enhancement)
  - Attach them to `synthComplete`/`synthFailed` messages
- **No output is silently lost.** The question isn't "where does stdout go?" but "how do we present IoHost messages to the user?" That's a UI concern for the LSP/web clients, not an architectural risk.

### What the daemon's IoHost implementation looks like

```typescript
const ioHost: IIoHost = {
  async notify(msg: IoMessage<unknown>) {
    // Forward to subscribers as structured messages
    broadcast({ type: 'ioMessage', level: msg.level, code: msg.code, message: msg.message });
    // Also log to file for debugging
    logFile.write(`[${msg.level}] ${msg.message}\n`);
  },
  async requestResponse(msg: IoRequest<unknown, unknown>) {
    // Non-interactive: always return the default response
    return msg.defaultResponse;
  },
};
```

### Evidence

- `packages/@aws-cdk/toolkit-lib/lib/api/cloud-assembly/private/exec.ts:40-41` — child spawned with piped stdio
- `packages/@aws-cdk/toolkit-lib/lib/api/cloud-assembly/source-builder.ts:519-527` — eventPublisher routes to IoHost
- `packages/@aws-cdk/toolkit-lib/lib/api/io/io-host.ts:3-17` — IIoHost interface
- `packages/@aws-cdk/toolkit-lib/lib/api/io/toolkit-action.ts:7` — 'synth' is a valid ToolkitAction

### Rico's questions answered

**Q6: What happens to the CDK app's stdout/stderr?**
It goes through `IIoHost.notify()` as structured messages. The daemon receives all of it. Nothing is lost. Clients (LSP, web server) can display it or ignore it.

**Q7: What if the app's behavior is different without a terminal?**
The app never has a terminal. `execInChildProcess` always uses piped stdio. This is identical whether you run `cdk synth` from a terminal, from CI, or from the daemon. The CDK app's synthesis output is deterministic regardless of the caller's TTY status.
