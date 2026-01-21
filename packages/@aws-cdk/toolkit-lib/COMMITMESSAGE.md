When executing CDK apps, users specify the `{ "app" }` command as a `string` (heavily advertised) or a `string[]` (not really advertised but historically possible through specific code paths).

In case the command line is a `string`, the only feasible interpretation of that is by executing the command line through a shell, either `bash` or `cmd.exe`. If the command line is a `string[]`, we would historically coerce it to a `string` by joining it with spaces and then proceeding as usual.

## Historical processing of .js files

Historically we have done trivial parsing and preprocessing the `"app"` command in order to help the user achieve success. Specifically: if the string pointed to a `.js` file we would run that `.js` file through a Node interpreter, even if there would be potential misconfiguration obstacles in the way.

Specifically:

- We're on POSIX and the file was not marked as executable (can happen if the file is freshly produced by a `tsc` invocation); or
- We're on Windows and there is no shell association set up for `.js` files on Windows.

That light parsing used to fail in the following cases.

- If the pointed-to file had spaces in its path.
- If Node was installed in a location that had spaces in its path.

In this PR we document the choice of command line string a bit better, and handle the cases where the file or interpreter paths can have spaces in them (this PR closes #636).

We still don't do fully generic command line parsing, because it's extremely complex on Windows and we can probably not do it correctly; we're just concerned with quoting the target and interpreter.

## Execution of string[]

Historically, a `string[]` was coerced to a `string` by doing `argv.join(' ')` and then processed as normal.

This has as a downside that even though the command line is already partitioned into components that can go directly into [execve()](https://man7.org/linux/man-pages/man2/execve.2.html) and prevent shell injection -- everyone's favorite w



## About shell execution

We are using shell execution on purpose:

- It's used for tests
- It's necessary on Windows to properly execute `.bat` and `.cmd` files
- Since we have historically offered it you can bet dollars to doughnuts that customers have built workflows depending on that.

This is all a preface to explain why we don't have an `argv` array. Automated code scanning tools will probably complain, but we can't change any of this. And since the source of the string and the machine it's executing on are part of the same security domain (it's all "the customer": the customer writes the command string, then executes it on their own machine), that is fine.

---
By submitting this pull request, I confirm that my contribution is made under the terms of the Apache-2.0 license

