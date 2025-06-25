#!/bin/bash
set -eu
scriptdir=$(cd $(dirname $0) && pwd)

path=$(realpath $1)

cat <<EOF > $scriptdir/manual-test-manifest.json
{
  "version": "38.0.1",
  "files": {
    "asset1": {
      "type": "file",
      "source": { "path": "$path" },
      "destinations": {
        "dest1": { "bucketName": "$2", "objectKey": "$3" }
      }
    }
  }
}
EOF

npx ts-node $scriptdir/../bin/cdk-assets.ts -v -p $scriptdir/manual-test-manifest.json publish