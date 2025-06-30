#!/bin/bash
echo "Running with arguments: $@"
./packages/aws-cdk/bin/cdk init "$@"