#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MyCustomStack } from '../lib/my-custom-stack';

const app = new cdk.App();
new MyCustomStack(app, 'MyCustomStack');