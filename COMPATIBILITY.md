# CDK CLI and AWS Construct Library compatibility table

The table below show what version of the CDK CLI is required for a particular
version of the AWS Construct Library:

The table below contains the specific versions of the schema, along with the
CLI that supports them and the Construct Library that uses them.

| Library version | Minimum CLI Version | Schema Version |
|-----------------|---------------------|----------------|
| 2.174.0         | 2.174.0             |  39            |
| 2.182.0         | 2.1000.0            |  40            |
| (unreleased)    | 2.1003.0            |  41            |

How to use this table: find your library version in the leftmost column.
If it's not in there, find the highest version lower than your library version.
The middle column indicates the minimum version of the CDK CLI you need to use.

## How it works

(This section describes how the protocol between App and CLI is versioned and
is purely for reference; the table above contains the most important information.)

The compatibility between the construct library and the CLI is based on the
version of the [Cloud Assembly Schema](./packages/@aws-cdk/cloud-assembly-schema)
used by the construct library and supported by the CLI app. The app writes
a particular version `X` of the Cloud Assembly, and the CLI can read all versions
up to and including the version `Y` that was current when it was released. We
need `X <= Y`.

```
┌────────┐          ┌─────────┐           ┌──────────┐
│        │ (writes) │         │  (reads)  │          │
│  App   │─────────▶│ cdk.out │◀──────────│   CLI    │
│        │          │         │           │          │
└────────┘  schema  └─────────┘  schemas  └──────────┘
             vX                  <= vY
```

### Compatibility rule for CLI < 2.1000.0

Before CDK CLI `2.1000.0`, the CLI and the library were released in lockstep
with the same version number, and so the versions `X` and `Y` above are the
same for a given version number.

An easy compatibility rule therefore is: the CLI supports apps written against
the AWS Construct Library with the same version or lower. It might support more
versions as well, but it *at least* supports those.

This works because `v(App) <= v(CLI)` guarantees that `X <= Y`.

### Compatibility rule for CLI >= 2.1000.0

Since CDK CLI `2.1000.0`, the CLI and construct library have two different
versions. The only rule that relates `X` and `Y` involves the *release date* of
the respective packages. The CLI version that supports a particular schema version
is always released before a CDK app starts emitting cloud assemblies using
that schema.

A general rule therefore is: a particular library version's Cloud Assemblies
are supported by the CLI that is current at the time of the library's release,
as well as every newer CLI version. It might be supported by older versions, but
it is *at least* supported by those.

This works because the CLI that is current at time of release of a
particular library version can always handle the output of that library
version and every version before it.

In a visual example:

```
                             this CLI version...
                                    ⋎
                                    o
CLI           │     │     │         │       │      │     │      │
        ─────┬┴─────┴┬────┴──┬────┬─┴────┬──┴──────┴┬────┴───┬──┴───→ (time)
Library      │       │       │    │      │          │        │
             ⋏       ⋏       ⋏    ⋏      ⋏
   ...supports at least these library versions
```

And the other way around:

```
                             this library version...
                                         ⋎
                                         o
Library      │       │       │    │      │          │        │
        ─────┴┬─────┬┴────┬──┴────┴─┬────┴──┬──────┬┴────┬───┴──┬────→ (time)
CLI           │     │     │         │       │      │     │      │
                                    ⋏       ⋏      ⋏     ⋏      ⋏
                                ...is supported by these CLI versions
```
