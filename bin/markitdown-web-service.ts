#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MarkitdownWebStack } from '../lib/markitdown-web-stack';
import { WafStack } from '../lib/waf-stack';

const app = new cdk.App();

const allowedIpAddresses = app.node.tryGetContext('allowedIpAddresses') as string[] || [];

let wafStack: WafStack | undefined;

if (allowedIpAddresses.length > 0) {
  wafStack = new WafStack(app, 'WafStack', {
    allowedIpAddresses,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: 'us-east-1',
    },
    crossRegionReferences: true,
  });
}

new MarkitdownWebStack(app, 'MarkitdownWebStack', {
  wafStack,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  crossRegionReferences: true,
});
