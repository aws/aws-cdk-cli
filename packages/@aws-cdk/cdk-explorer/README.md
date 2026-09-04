# @aws-cdk/cdk-explorer

A Language Server (LSP) for AWS CDK apps. It runs your CDK app, reads the
synthesized cloud assembly from your project's `cdk.out` directory, and
surfaces that back in your editor: code lenses on the constructs you author,
hover details from the generated CloudFormation, go-to-definition from a
template to the construct that created it, and diagnostics from policy
validation.

Used by the `cdk lsp` command in the AWS CDK CLI. It is for CDK developers who
want in-editor feedback without leaving their source files.

## Installing and running

The server ships inside the AWS CDK CLI. Start it over stdio:

    cdk lsp

Your editor's LSP client launches that command and talks to it over
stdin/stdout. You can also start it programmatically:

    import { startLspServer } from '@aws-cdk/cdk-explorer';
    startLspServer();

## Features

- Code lenses on source lines that create resources: `Creates <Type>` opens that
  resource in the synthesized template (a picker when a line maps to several),
  plus `Synth now` / `Enable auto-synth` / `Disable auto-synth` in the file header.
- Hover: a construct's resolved CloudFormation properties and a link to the
  generated template.
- Go to definition: from a position in a synthesized `*.template.json` back to the
  construct source that produced it.
- Diagnostics: findings from the policy validation report appear as squiggles in
  your source. The rule description and any suggested fix ride in the diagnostic
  message, so your editor shows them when you hover the squiggle and in its
  problems list. The report identifies a violating construct rather than a source
  line, so a squiggle sits on the line that creates the construct, not on the
  specific property at fault.

Source-linked features (code lenses, hover, go to definition) currently work for
TypeScript and Python.

## Security

`Enable auto-synth` runs your app on every save. When it is on, saving a file
runs the `app` command from your `cdk.json` (the same command `cdk synth` runs)
in a subprocess, with your shell environment and AWS credentials. The
`Synth now` code lens does the same once, on demand.

This mirrors how `cdk synth` and `cdk watch` already work, but the code lens
makes it a single click. Enable auto-synth only for projects you trust. Do not
enable it in a workspace whose `cdk.json` or source you have not reviewed, as
opening it and saving would run that project's command with your credentials.

## Editor integration

`cdk lsp` is a standard stdio language server. No editor plugin is published
yet; any LSP client can integrate:

- Launch `cdk lsp` and connect over stdin/stdout.
- On `initialize`, set `initializationOptions.applicationDir` to the CDK project
  root (the directory containing `cdk.json`). It falls back to the server's
  working directory if omitted.
- The server advertises hover, go-to-definition, code lens, and
  `workspace/executeCommand` for `cdk.explorer.synthNow`,
  `cdk.explorer.enableAutoSynth`, and `cdk.explorer.disableAutoSynth`.
- Register a client command named `cdkExplorer.openResource` so the resource
  lenses navigate. It receives a list of `{ label, description, target }` items;
  open the target's template location, showing a picker when there is more than
  one.
- To refresh lenses after a synth, advertise `workspace.codeLens.refreshSupport`
  in your client capabilities.

`cdk lsp` is intended to be consumed by an editor extension. Because enabling
auto-synth runs project code with your credentials (see Security above), the
integrating extension should gate the first `Enable auto-synth` in a workspace
behind the editor's workspace-trust prompt.

### Connecting from VS Code with a generic LSP client

Until a dedicated extension is published, you can drive `cdk lsp` from VS Code
today with a general-purpose "generic LSP client" extension: one that spawns an
executable you name and speaks LSP to it over stdio. These are third-party
extensions, not published by AWS, so review one before installing it. One
example is [Generic LSP Client](https://marketplace.visualstudio.com/items?itemName=zsol.vscode-glspc)
(`zsol.vscode-glspc`).

Point it at `cdk lsp` in your **User** `settings.json` (not a workspace
`.vscode/settings.json`; see the note below):

```jsonc
{
  "glspc.server.command": "cdk",
  "glspc.server.commandArguments": ["lsp"],
  "glspc.server.languageId": ["typescript", "python"],
  // Set these only if VS Code was not launched from a shell that has your
  // toolchain on PATH. `$VAR` expands existing environment variables.
  "glspc.server.environmentVariables": {
    "PATH": "/absolute/path/to/node/bin:$PATH"
  }
}
```

Requires `aws-cdk >= 2.1132.0`. Hover and diagnostics work over this path; the
click-through features do not, because a generic client does not implement the
protocol wiring described above. Trade-offs versus a purpose-built extension:

- **PATH and toolchain.** The server runs your `app` command in a subprocess to
  synth. VS Code launched from the Dock or Spotlight does not source your shell
  profile, so an nvm-managed `node` will not be found and synth fails. Launch
  with `code .` from a configured shell, or set `PATH` (and `JAVA_HOME`
  for Java apps) in `glspc.server.environmentVariables`.
- **Template files are not covered.** A generic client attaches by language id,
  and synthesized `*.template.json` files are plain `json` to VS Code. There is
  no way to attach only to template files without attaching to every JSON file,
  so go-to-definition from a template is not available on this path.
- **Resource and auto-synth lenses do not act.** Navigating from a `Creates ...`
  lens relies on the client registering the `cdkExplorer.openResource` command
  described above, and the `Synth now` / auto-synth lenses need a client binding
  to invoke them. A generic client provides neither, so those lenses appear but
  are not actionable.
- **No version or trust handling.** There is no upgrade prompt on an old CLI,
  and because `glspc.server.command` is a window-scoped setting a workspace can
  override which executable is spawned. Keep the configuration in User settings,
  and only trust workspaces whose `cdk.json` and source you have reviewed (see
  Security above).

## Supported clients

LSP clients speaking Language Server Protocol 3.x.
