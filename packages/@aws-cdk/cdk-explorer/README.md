# @aws-cdk/cdk-explorer

A Language Server (LSP) for AWS CDK apps. It runs your CDK app, reads the
synthesized cloud assembly, and surfaces that back in your editor: code lenses
on the constructs you author, hover details from the generated CloudFormation,
go-to-definition from a template to the construct that created it, and
diagnostics from policy validation.

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
- Diagnostics: policy validation report findings appear as squiggles in source.

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

## Supported clients

LSP clients speaking Language Server Protocol 3.x.
