import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class WafStack extends cdk.Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: cdk.StackProps & { allowedIpAddresses: string[] }) {
    super(scope, id, props);

    // CloudFront用のWAF Web ACL (us-east-1リージョンに作成)
    const ipSet = new wafv2.CfnIPSet(this, 'AllowedIPSetCloudFront', {
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV4',
      addresses: props.allowedIpAddresses,
    });

    const webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { block: {} },
      rules: [
        {
          name: 'AllowSpecificIPsCloudFront',
          priority: 1,
          statement: {
            ipSetReferenceStatement: {
              arn: ipSet.attrArn,
            },
          },
          action: { allow: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AllowSpecificIPsCloudFrontRule',
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'CloudFrontWebAcl',
      },
    });

    this.webAclArn = webAcl.attrArn;

    // Export the WebACL ARN for cross-stack reference
    new cdk.CfnOutput(this, 'WebAclArn', {
      value: webAcl.attrArn,
      exportName: 'CloudFrontWebAclArn',
    });
  }
}
