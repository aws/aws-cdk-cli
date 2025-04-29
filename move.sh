#!/usr/bin/env bash

rsync -av ./packages/@aws-cdk/tmp-toolkit-helpers/test/ ./packages/@aws-cdk/toolkit-lib/test/
rsync -av ./packages/@aws-cdk/tmp-toolkit-helpers/src/ ./packages/@aws-cdk/toolkit-lib/lib/

git apply rm-tmp.patch
npx projen
