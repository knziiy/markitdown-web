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
      environment: {
        'TZ': 'UTC',
        'TMPDIR': '/tmp/markitdown',
        'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONUNBUFFERED': '1'
      },
      reservedConcurrentExecutions: 100,
    });

    const api = new apigateway.RestApi(this, 'MarkitdownApi', {
      restApiName: 'Markitdown Web Service',
      description: 'API for converting files to markdown',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
        maxAge: cdk.Duration.hours(1),
      },
      deployOptions: {
        stageName: 'api',
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,  // Disable logging of sensitive data
        metricsEnabled: true
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
      }
    });

    const convertResource = api.root.addResource('convert');

    // POST: /convert 
    const convertMethod = convertResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(markitdownFunction, {
        timeout: cdk.Duration.seconds(29),  // Timeout for Lambda integration
      }),
      {
        requestParameters: {
          'method.request.header.Content-Type': true
        },
        requestValidatorOptions: {
          requestValidatorName: 'validate-request-body',
          validateRequestBody: true,
          validateRequestParameters: true,
        }
      }
    );

    // rate limiting
    new apigateway.UsagePlan(this, 'MarkitdownUsagePlan', {
      name: 'MarkitdownUsagePlan',
      throttle: {
        rateLimit: 100,    // 100 requests/second
        burstLimit: 200    // 200 requests burst
      },
      quota: {
        limit: 10000,      // 10,000 requests per day
        period: apigateway.Period.DAY
      },
      apiStages: [{
        api: api,
        stage: api.deploymentStage
      }]
    });

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

    // Security headers function
    const securityHeadersFunction = new cloudfront.Function(this, 'SecurityHeadersFunction', {
      functionName: 'markitdown-security-headers',
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var response = event.response;
          var headers = response.headers;
          
          headers['strict-transport-security'] = { value: 'max-age=31536000; includeSubdomains; preload' };
          headers['content-type-options'] = { value: 'nosniff' };
          headers['frame-options'] = { value: 'DENY' };
          headers['xss-protection'] = { value: '1; mode=block' };
          headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
          headers['permissions-policy'] = { value: 'camera=(), microphone=(), geolocation=()' };
          
          return response;
        }
      `)
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      webAclId: props?.wafStack?.webAclArn,
      enableIpv6: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        functionAssociations: [
          {
            function: securityHeadersFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE
          }
        ],
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
          responseHeadersPolicyName: 'MarkitdownSecurityHeaders',
          securityHeadersBehavior: {
            contentTypeOptions: { override: true },
            frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
            referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
            strictTransportSecurity: { 
              accessControlMaxAge: cdk.Duration.seconds(31536000), 
              includeSubdomains: true, 
              preload: true,
              override: true 
            },
            contentSecurityPolicy: { 
              contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.execute-api.*.amazonaws.com", 
              override: true 
            }
          }
        })
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        }
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
