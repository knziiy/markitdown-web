import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { NodejsBuild } from 'deploy-time-build';
import { WafStack } from './waf-stack';
import * as path from 'path';

export interface MarkitdownWebStackProps extends cdk.StackProps {
  wafStack?: WafStack;
}

export class MarkitdownWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MarkitdownWebStackProps) {
    super(scope, id, props);

    const allowedIpAddresses = this.node.tryGetContext('allowedIpAddresses') as string[] || [];

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `markitdown-website-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const markitdownFunction = new lambda.Function(this, 'MarkitdownFunction', {
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      code: lambda.Code.fromAssetImage(path.join(__dirname, '../lambda'), {
        file: 'Dockerfile',
      }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      architecture: lambda.Architecture.X86_64,
    });

    const api = new apigateway.RestApi(this, 'MarkitdownApi', {
      restApiName: 'Markitdown Web Service',
      description: 'API for converting files to markdown',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: 'api',
      },
    });

    const convertResource = api.root.addResource('convert');

    // POST: /convert
    convertResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(markitdownFunction),
    );

    // WAF Web ACL for API Gateway (if IP addresses are specified)
    let apiGatewayWebAcl: wafv2.CfnWebACL | undefined;
    if (allowedIpAddresses.length > 0) {
      apiGatewayWebAcl = new wafv2.CfnWebACL(this, 'ApiGatewayWebAcl', {
        scope: 'REGIONAL',
        defaultAction: { block: {} },
        rules: [
          {
            name: 'AllowSpecificIPs',
            priority: 1,
            statement: {
              ipSetReferenceStatement: {
                arn: new wafv2.CfnIPSet(this, 'AllowedIPSet', {
                  scope: 'REGIONAL',
                  ipAddressVersion: 'IPV4',
                  addresses: allowedIpAddresses,
                }).attrArn,
              },
            },
            action: { allow: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'AllowSpecificIPsRule',
            },
          },
        ],
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'ApiGatewayWebAcl',
        },
      });

      // Associate WAF with API Gateway
      new wafv2.CfnWebACLAssociation(this, 'ApiGatewayWebAclAssociation', {
        resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
        webAclArn: apiGatewayWebAcl.attrArn,
      });
    }

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      webAclId: props?.wafStack?.webAclArn,
      enableIpv6: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    const build = new NodejsBuild(this, 'BuildWeb', {
      assets: [
        {
          path: path.join(__dirname, '../frontend'),
          exclude: [
            'node_modules/**/*',
            '.git/**/*',
            'build/**/*',
            'dist/**/*',
          ],
        },
      ],
      destinationBucket: websiteBucket,
      distribution: distribution,
      outputSourceDirectory: 'build',
      buildCommands: ['npm ci', 'npm run build'],
      buildEnvironment: {
        REACT_APP_API_ENDPOINT: api.url,
      },
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Website URL',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: 'MarkitdownApiEndpoint',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 Bucket Name',
    });
  }
}
