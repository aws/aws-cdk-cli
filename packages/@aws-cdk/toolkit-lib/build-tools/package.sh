#!/usr/bin/env bash

version=${1:-latest}
reset=0.0.0
commit=$(git rev-parse --short HEAD)

# Toolkit package root
cd "$(dirname $(dirname "$0"))"

rm -rf dist/
mkdir -p dist/js
npm pkg set version=0.0.0-alpha.$commit
npm pkg set dependencies.@aws-cdk/cloud-assembly-schema=$version
npm pkg set dependencies.@aws-cdk/cloudformation-diff=$version
npm pack --pack-destination dist/js
npm pkg set version=$reset
npm pkg set dependencies.@aws-cdk/cloudformation-diff=^$reset``
npm pkg set dependencies.@aws-cdk/cloud-assembly-schema=^$reset``
