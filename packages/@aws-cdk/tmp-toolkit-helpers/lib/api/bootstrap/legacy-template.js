"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyBootstrapTemplate = legacyBootstrapTemplate;
const bootstrap_props_1 = require("./bootstrap-props");
function legacyBootstrapTemplate(params) {
    return {
        Description: 'The CDK Toolkit Stack. It was created by `cdk bootstrap` and manages resources necessary for managing your Cloud Applications with AWS CDK.',
        Conditions: {
            UsePublicAccessBlockConfiguration: {
                'Fn::Equals': [
                    params.publicAccessBlockConfiguration || params.publicAccessBlockConfiguration === undefined ? 'true' : 'false',
                    'true',
                ],
            },
        },
        Resources: {
            StagingBucket: {
                Type: 'AWS::S3::Bucket',
                Properties: {
                    BucketName: params.bucketName,
                    AccessControl: 'Private',
                    BucketEncryption: {
                        ServerSideEncryptionConfiguration: [{
                                ServerSideEncryptionByDefault: {
                                    SSEAlgorithm: 'aws:kms',
                                    KMSMasterKeyID: params.kmsKeyId,
                                },
                            }],
                    },
                    PublicAccessBlockConfiguration: {
                        'Fn::If': [
                            'UsePublicAccessBlockConfiguration',
                            {
                                BlockPublicAcls: true,
                                BlockPublicPolicy: true,
                                IgnorePublicAcls: true,
                                RestrictPublicBuckets: true,
                            },
                            { Ref: 'AWS::NoValue' },
                        ],
                    },
                },
            },
            StagingBucketPolicy: {
                Type: 'AWS::S3::BucketPolicy',
                Properties: {
                    Bucket: { Ref: 'StagingBucket' },
                    PolicyDocument: {
                        Id: 'AccessControl',
                        Version: '2012-10-17',
                        Statement: [
                            {
                                Sid: 'AllowSSLRequestsOnly',
                                Action: 's3:*',
                                Effect: 'Deny',
                                Resource: [
                                    { 'Fn::Sub': '${StagingBucket.Arn}' },
                                    { 'Fn::Sub': '${StagingBucket.Arn}/*' },
                                ],
                                Condition: {
                                    Bool: { 'aws:SecureTransport': 'false' },
                                },
                                Principal: '*',
                            },
                        ],
                    },
                },
            },
        },
        Outputs: {
            [bootstrap_props_1.BUCKET_NAME_OUTPUT]: {
                Description: 'The name of the S3 bucket owned by the CDK toolkit stack',
                Value: { Ref: 'StagingBucket' },
            },
            [bootstrap_props_1.BUCKET_DOMAIN_NAME_OUTPUT]: {
                Description: 'The domain name of the S3 bucket owned by the CDK toolkit stack',
                Value: { 'Fn::GetAtt': ['StagingBucket', 'RegionalDomainName'] },
            },
        },
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGVnYWN5LXRlbXBsYXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9ib290c3RyYXAvbGVnYWN5LXRlbXBsYXRlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBR0EsMERBNEVDO0FBOUVELHVEQUFrRjtBQUVsRixTQUFnQix1QkFBdUIsQ0FBQyxNQUErQjtJQUNyRSxPQUFPO1FBQ0wsV0FBVyxFQUFFLDZJQUE2STtRQUMxSixVQUFVLEVBQUU7WUFDVixpQ0FBaUMsRUFBRTtnQkFDakMsWUFBWSxFQUFFO29CQUNaLE1BQU0sQ0FBQyw4QkFBOEIsSUFBSSxNQUFNLENBQUMsOEJBQThCLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE9BQU87b0JBQy9HLE1BQU07aUJBQ1A7YUFDRjtTQUNGO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsYUFBYSxFQUFFO2dCQUNiLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLFVBQVUsRUFBRTtvQkFDVixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7b0JBQzdCLGFBQWEsRUFBRSxTQUFTO29CQUN4QixnQkFBZ0IsRUFBRTt3QkFDaEIsaUNBQWlDLEVBQUUsQ0FBQztnQ0FDbEMsNkJBQTZCLEVBQUU7b0NBQzdCLFlBQVksRUFBRSxTQUFTO29DQUN2QixjQUFjLEVBQUUsTUFBTSxDQUFDLFFBQVE7aUNBQ2hDOzZCQUNGLENBQUM7cUJBQ0g7b0JBQ0QsOEJBQThCLEVBQUU7d0JBQzlCLFFBQVEsRUFBRTs0QkFDUixtQ0FBbUM7NEJBQ25DO2dDQUNFLGVBQWUsRUFBRSxJQUFJO2dDQUNyQixpQkFBaUIsRUFBRSxJQUFJO2dDQUN2QixnQkFBZ0IsRUFBRSxJQUFJO2dDQUN0QixxQkFBcUIsRUFBRSxJQUFJOzZCQUM1Qjs0QkFDRCxFQUFFLEdBQUcsRUFBRSxjQUFjLEVBQUU7eUJBQ3hCO3FCQUNGO2lCQUNGO2FBQ0Y7WUFDRCxtQkFBbUIsRUFBRTtnQkFDbkIsSUFBSSxFQUFFLHVCQUF1QjtnQkFDN0IsVUFBVSxFQUFFO29CQUNWLE1BQU0sRUFBRSxFQUFFLEdBQUcsRUFBRSxlQUFlLEVBQUU7b0JBQ2hDLGNBQWMsRUFBRTt3QkFDZCxFQUFFLEVBQUUsZUFBZTt3QkFDbkIsT0FBTyxFQUFFLFlBQVk7d0JBQ3JCLFNBQVMsRUFBRTs0QkFDVDtnQ0FDRSxHQUFHLEVBQUUsc0JBQXNCO2dDQUMzQixNQUFNLEVBQUUsTUFBTTtnQ0FDZCxNQUFNLEVBQUUsTUFBTTtnQ0FDZCxRQUFRLEVBQUU7b0NBQ1IsRUFBRSxTQUFTLEVBQUUsc0JBQXNCLEVBQUU7b0NBQ3JDLEVBQUUsU0FBUyxFQUFFLHdCQUF3QixFQUFFO2lDQUN4QztnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QsSUFBSSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsT0FBTyxFQUFFO2lDQUN6QztnQ0FDRCxTQUFTLEVBQUUsR0FBRzs2QkFDZjt5QkFDRjtxQkFDRjtpQkFDRjthQUNGO1NBQ0Y7UUFDRCxPQUFPLEVBQUU7WUFDUCxDQUFDLG9DQUFrQixDQUFDLEVBQUU7Z0JBQ3BCLFdBQVcsRUFBRSwwREFBMEQ7Z0JBQ3ZFLEtBQUssRUFBRSxFQUFFLEdBQUcsRUFBRSxlQUFlLEVBQUU7YUFDaEM7WUFDRCxDQUFDLDJDQUF5QixDQUFDLEVBQUU7Z0JBQzNCLFdBQVcsRUFBRSxpRUFBaUU7Z0JBQzlFLEtBQUssRUFBRSxFQUFFLFlBQVksRUFBRSxDQUFDLGVBQWUsRUFBRSxvQkFBb0IsQ0FBQyxFQUFFO2FBQ2pFO1NBQ0Y7S0FDRixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQm9vdHN0cmFwcGluZ1BhcmFtZXRlcnMgfSBmcm9tICcuL2Jvb3RzdHJhcC1wcm9wcyc7XG5pbXBvcnQgeyBCVUNLRVRfRE9NQUlOX05BTUVfT1VUUFVULCBCVUNLRVRfTkFNRV9PVVRQVVQgfSBmcm9tICcuL2Jvb3RzdHJhcC1wcm9wcyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBsZWdhY3lCb290c3RyYXBUZW1wbGF0ZShwYXJhbXM6IEJvb3RzdHJhcHBpbmdQYXJhbWV0ZXJzKTogYW55IHtcbiAgcmV0dXJuIHtcbiAgICBEZXNjcmlwdGlvbjogJ1RoZSBDREsgVG9vbGtpdCBTdGFjay4gSXQgd2FzIGNyZWF0ZWQgYnkgYGNkayBib290c3RyYXBgIGFuZCBtYW5hZ2VzIHJlc291cmNlcyBuZWNlc3NhcnkgZm9yIG1hbmFnaW5nIHlvdXIgQ2xvdWQgQXBwbGljYXRpb25zIHdpdGggQVdTIENESy4nLFxuICAgIENvbmRpdGlvbnM6IHtcbiAgICAgIFVzZVB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAnRm46OkVxdWFscyc6IFtcbiAgICAgICAgICBwYXJhbXMucHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uIHx8IHBhcmFtcy5wdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb24gPT09IHVuZGVmaW5lZCA/ICd0cnVlJyA6ICdmYWxzZScsXG4gICAgICAgICAgJ3RydWUnLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9LFxuICAgIFJlc291cmNlczoge1xuICAgICAgU3RhZ2luZ0J1Y2tldDoge1xuICAgICAgICBUeXBlOiAnQVdTOjpTMzo6QnVja2V0JyxcbiAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgIEJ1Y2tldE5hbWU6IHBhcmFtcy5idWNrZXROYW1lLFxuICAgICAgICAgIEFjY2Vzc0NvbnRyb2w6ICdQcml2YXRlJyxcbiAgICAgICAgICBCdWNrZXRFbmNyeXB0aW9uOiB7XG4gICAgICAgICAgICBTZXJ2ZXJTaWRlRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb246IFt7XG4gICAgICAgICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnYXdzOmttcycsXG4gICAgICAgICAgICAgICAgS01TTWFzdGVyS2V5SUQ6IHBhcmFtcy5rbXNLZXlJZCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAnRm46OklmJzogW1xuICAgICAgICAgICAgICAnVXNlUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIEJsb2NrUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBCbG9ja1B1YmxpY1BvbGljeTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBJZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICAgICAgICAgIFJlc3RyaWN0UHVibGljQnVja2V0czogdHJ1ZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgeyBSZWY6ICdBV1M6Ok5vVmFsdWUnIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgU3RhZ2luZ0J1Y2tldFBvbGljeToge1xuICAgICAgICBUeXBlOiAnQVdTOjpTMzo6QnVja2V0UG9saWN5JyxcbiAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgIEJ1Y2tldDogeyBSZWY6ICdTdGFnaW5nQnVja2V0JyB9LFxuICAgICAgICAgIFBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgICBJZDogJ0FjY2Vzc0NvbnRyb2wnLFxuICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBTaWQ6ICdBbGxvd1NTTFJlcXVlc3RzT25seScsXG4gICAgICAgICAgICAgICAgQWN0aW9uOiAnczM6KicsXG4gICAgICAgICAgICAgICAgRWZmZWN0OiAnRGVueScsXG4gICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtcbiAgICAgICAgICAgICAgICAgIHsgJ0ZuOjpTdWInOiAnJHtTdGFnaW5nQnVja2V0LkFybn0nIH0sXG4gICAgICAgICAgICAgICAgICB7ICdGbjo6U3ViJzogJyR7U3RhZ2luZ0J1Y2tldC5Bcm59LyonIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICAgICAgICAgIEJvb2w6IHsgJ2F3czpTZWN1cmVUcmFuc3BvcnQnOiAnZmFsc2UnIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBQcmluY2lwYWw6ICcqJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBPdXRwdXRzOiB7XG4gICAgICBbQlVDS0VUX05BTUVfT1VUUFVUXToge1xuICAgICAgICBEZXNjcmlwdGlvbjogJ1RoZSBuYW1lIG9mIHRoZSBTMyBidWNrZXQgb3duZWQgYnkgdGhlIENESyB0b29sa2l0IHN0YWNrJyxcbiAgICAgICAgVmFsdWU6IHsgUmVmOiAnU3RhZ2luZ0J1Y2tldCcgfSxcbiAgICAgIH0sXG4gICAgICBbQlVDS0VUX0RPTUFJTl9OQU1FX09VVFBVVF06IHtcbiAgICAgICAgRGVzY3JpcHRpb246ICdUaGUgZG9tYWluIG5hbWUgb2YgdGhlIFMzIGJ1Y2tldCBvd25lZCBieSB0aGUgQ0RLIHRvb2xraXQgc3RhY2snLFxuICAgICAgICBWYWx1ZTogeyAnRm46OkdldEF0dCc6IFsnU3RhZ2luZ0J1Y2tldCcsICdSZWdpb25hbERvbWFpbk5hbWUnXSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xufVxuIl19