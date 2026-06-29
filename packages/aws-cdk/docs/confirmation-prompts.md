# Confirmation Prompts

This document defines how the CLI must behave when a user declines a confirmation
prompt (answers "no" to a question like "Are you sure you want to delete ...?",
"Perform import?", or "Do you want to accept these changes?").

This is a convention. Apply it to every command that asks for confirmation, so
that declining behaves the same way everywhere.

## The rule

**Declining a confirmation exits non-zero and fails soft.**

These are two independent decisions:

1. **Exit code: non-zero.** The exit code answers a single question: did the
   operation the user asked for happen? When the user declines, it did not, so
   the command exits non-zero, the same as any other "the requested change did
   not occur" outcome.
2. **Presentation: soft.** A decline is an expected, user-initiated outcome, not
   a defect. It must print a single clear line (no stack trace, no "internal
   error" framing) and must not be counted as a crash or error in telemetry. It
   is tagged as a user abort.

In short: the exit code reflects "did the thing happen" (no, so non-zero); soft
vs hard reflects "is this a bug" (no, so soft).

## Why non-zero

- **Post-condition.** The user asked to deploy, destroy, import, or apply. It did
  not happen. The exit code should reflect the resulting state, not whose choice
  caused it.
- **Chaining safety.** Shell chains such as `cdk deploy && ./promote.sh` must not
  continue when the deploy did not happen. This applies in interactive terminals
  too, where developers routinely use `&&`. A non-zero exit short-circuits the
  chain; exit 0 would let the next step run as if the operation succeeded.
- **Ecosystem convention.** Comparable infrastructure tools do the same. For
  example `terraform apply` answered "no" prints "Apply cancelled" and exits
  non-zero, and `apt` answered "n" prints "Abort." and exits non-zero. Declining
  a prompt is also equivalent to pressing Ctrl-C at the prompt, which is
  non-zero.

A confirmation prompt only appears in interactive use. In a non-interactive
context the CLI cannot ask, so the prompt path is already an error (see below).
That means the non-zero rule keeps the interactive decline consistent with the
non-interactive case: in both, the operation did not happen.

## How to implement it

The `IoHost` does not decide whether to abort. `requestResponse` returns the
user's answer (including `false` for a declined confirmation) and never throws on
a decline. Each command owns the decline and reacts to a `false` answer by
throwing an `AbortError`:

```ts
const confirmed = await ioHelper.requestResponse(IO.SOME_CONFIRMATION.req(question));
if (!confirmed) {
  throw new AbortError('SomethingAborted');
}
```

`AbortError` is a dedicated `ToolkitError` subclass (`AbortError.isAbortError(x)`)
that marks a user-initiated abort. It still carries a per-action error code (for
example `DeployAborted`, `RollbackAborted`) so the reason stays clear in output
and telemetry, while the marker gives the CLI one reliable way to detect a
decline without matching on messages.

The default message is `Operation cancelled`, a safe generic fallback. Prefer a
specific message in the form `<Operation> cancelled` (sentence case, no trailing
period), for example `Deployment cancelled` or `Import cancelled`, so the output
names what was cancelled.

The CLI's top-level error handler detects `AbortError` and applies the policy
above: a non-zero exit, a soft presentation (the message only, no stack trace or
"error" framing), and a user-abort telemetry tag rather than a crash.

Do not let the `IoHost` throw an abort on the command's behalf, do not swallow a
decline into an exit-0 return, and do not signal a decline with a plain
`ToolkitError` that the handler cannot distinguish from a real failure.
