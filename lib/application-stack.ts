import { AwsCustomResource, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import {
    PolicyStatement, PolicyDocument, AnyPrincipal, Effect,
} from 'aws-cdk-lib/aws-iam';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import {
    Table, BillingMode, AttributeType, ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
    HostedZone, ARecord, RecordTarget, HostedZoneAttributes,
} from 'aws-cdk-lib/aws-route53';
import { ApiGatewayDomain } from 'aws-cdk-lib/aws-route53-targets';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
    DomainName, EndpointType, SecurityPolicy, BasePathMapping, RestApi, ApiKey, Period, LambdaIntegration,
    UsagePlanProps, UsagePlan, Model, JsonSchemaVersion, JsonSchemaType,
} from 'aws-cdk-lib/aws-apigateway';
import {
    Stack, Duration, RemovalPolicy, CfnOutput, StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

const deliveryEventTypes = ['SEND', 'DELIVERY', 'OPEN', 'CLICK'];
const reqEventTypes = ['REJECT', 'BOUNCE', 'COMPLAINT'];

interface ZoneAtttributes extends HostedZoneAttributes {
    apiHostname: string,
    certificateArn: string,
}

interface SesApplicationStackProps extends StackProps {
    appAttr: {
        appName: string,
        utcOffset: string,
        defaultFrom: string,
        emailList: string[],
        useApiKey: boolean,
        allowCidr: string[],
        dailyQuota: number,
        logExpiry: number,
    }
    domainAttr: ZoneAtttributes,
}

/**
 * Configures an API and application for sending email via SES.
 * Requires configuration of a domain in SES.
 *
 * @param {Construct} scope
 * @param {string} id
 * @param {SesApplicationStackProps} props
 */
export class SesApplicationStack extends Stack {
    apiKeySecret: Secret;

    constructor(scope: Construct, id: string, props: SesApplicationStackProps) {
        super(scope, id, props);

        console.log('Stack Name: ', this.stackName);

        const { appAttr, domainAttr } = props;
        const {
            appName, defaultFrom = 'no-reply', emailList = [], allowCidr = [], dailyQuota, useApiKey, logExpiry = 0, utcOffset,
        } = appAttr;
        const {
            zoneName = '', hostedZoneId = '', apiHostname = '', certificateArn = '',
        } = domainAttr;
        const useCustomDomain = (zoneName && hostedZoneId && apiHostname);

        // SES Configuration =========================================================================================

        // Creating custom policy for CustomResource due to CDK bug (uses email: instead of ses: when creating actions)
        const sesPolicy = new PolicyStatement({
            actions: [
                'ses:CreateConfigurationSet',
                'ses:DeleteConfigurationSet',
                'ses:CreateConfigurationSetEventDestination',
                'ses:DeleteConfigurationSetEventDestination',
                'ses:CreateEmailIdentity',
                'ses:DeleteEmailIdentity',
            ],
            resources: ['*'], // Global is required to Create. Delete could be restricted if required.
            effect: Effect.ALLOW,
        });

        // Create a Configuration Set for the app
        const ConfigurationSetName = `${appName}ConfigSet`;
        const configSet = new AwsCustomResource(this, ConfigurationSetName, {
            onUpdate: {
                service: 'SESV2',
                action: 'createConfigurationSet',
                parameters: {
                    ConfigurationSetName,
                    SendingOptions: { SendingEnabled: true },
                },
                physicalResourceId: {},
            },
            onDelete: {
                service: 'SESV2',
                action: 'deleteConfigurationSet',
                parameters: {
                    ConfigurationSetName,
                },
            },
            policy: AwsCustomResourcePolicy.fromStatements([sesPolicy]),
            logGroup: new LogGroup(this, `${ConfigurationSetName}Logs`, {
                retention: RetentionDays.ONE_WEEK,
            }),
        });

        // Add an SNS Destination for SES notifications
        // SNS Topic
        const sesNotificationsTopic = new Topic(this, `${appName}NotificationsTopic`, {
            displayName: `SES Email Notifications for ${appName}`,
        });

        //  Configure SES Event Destination to send to SNS
        const EventDestinationName = `${appName}Notifications`;
        const snsDest = new AwsCustomResource(this, EventDestinationName, {
            onUpdate: {
                service: 'SESV2',
                action: 'createConfigurationSetEventDestination',
                parameters: {
                    ConfigurationSetName,
                    EventDestinationName,
                    EventDestination: {
                        SnsDestination: {
                            TopicArn: sesNotificationsTopic.topicArn,
                        },
                        MatchingEventTypes: [...deliveryEventTypes, ...reqEventTypes],
                        Enabled: true,
                    },
                },
                physicalResourceId: {},
            },
            onDelete: {
                service: 'SESV2',
                action: 'deleteConfigurationSetEventDestination',
                parameters: {
                    ConfigurationSetName,
                    EventDestinationName,
                },
            },
            policy: AwsCustomResourcePolicy.fromStatements([sesPolicy]),
            logGroup: new LogGroup(this, `${EventDestinationName}Logs`, {
                retention: RetentionDays.ONE_WEEK,
            }),
        });
        snsDest.node.addDependency(configSet);

        /**
         * Add email addresses and send verification emails.
         *
         * Each identity is keyed by the email address itself (not its position in
         * emailList) so that adding, removing or reordering entries only ever
         * touches the resource for that specific email, rather than causing
         * CloudFormation to treat unrelated identities as updates/replacements.
         */
        emailList.forEach((email) => {
            new AwsCustomResource(this, `emailIdentity-${email}`, {
                onUpdate: {
                    service: 'SESV2',
                    action: 'createEmailIdentity',
                    parameters: {
                        EmailIdentity: email,
                    },
                    physicalResourceId: {},
                },
                onDelete: {
                    service: 'SESV2',
                    action: 'deleteEmailIdentity',
                    parameters: {
                        EmailIdentity: email,
                    },
                },
                policy: AwsCustomResourcePolicy.fromStatements([sesPolicy]),
                logGroup: new LogGroup(this, `emailIdentity-${email}-Logs`, {
                    retention: RetentionDays.ONE_WEEK,
                }),
            });
        });

        // DynamoDb Log Table ===================================================================================
        const destinationIdIndexName = 'destinationIdx';

        // DynamoDb table for the email logs
        const table = new Table(this, 'logTable', {
            tableName: `${appName}LogTable`,
            billingMode: BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: 'MessageId', type: AttributeType.STRING },
            sortKey: { name: 'LogTime', type: AttributeType.STRING },
            removalPolicy: RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ExpiryTime',
        });
        // Index for destination (email address) lookups
        table.addGlobalSecondaryIndex({
            indexName: destinationIdIndexName,
            partitionKey: { name: 'Destination', type: AttributeType.STRING },
            sortKey: { name: 'LogTime', type: AttributeType.STRING },
            projectionType: ProjectionType.ALL,
        });

        // Lambda Functions ====================================================================================

        // Lambda common props.
        // The @local/utils module is bundled directly into each function by esbuild
        // (NodejsFunction), so there is no longer a need for a shared Lambda Layer.
        const lambdaProps = {
            runtime: Runtime.NODEJS_24_X,
            timeout: Duration.seconds(5),
            bundling: {
                sourceMap: true,
                externalModules: ['@aws-sdk/*'],
            },
        };

        // Lambda common environment
        const lambdaEnv = {
            LOG_TABLE_NAME: table.tableName,
            LOG_EXPIRY: String(logExpiry),
        };

        // Lambda Send Email Function
        const sendEmailFnc = new NodejsFunction(this, 'sendEmailFnc', {
            description: 'Send Email API function',
            entry: `${__dirname}/lambda/send-email/index.ts`,
            environment: {
                CONFIGURATION_SET_NAME: ConfigurationSetName,
                DEFAULT_FROM_ADDRESS: `${defaultFrom}@${zoneName}`,
                ...lambdaEnv,
            },
            logGroup: new LogGroup(this, 'sendEmailFncLogs', {
                retention: RetentionDays.ONE_MONTH,
            }),
            ...lambdaProps,
        });
        table.grantReadWriteData(sendEmailFnc);
        // Allow function to send email via SES
        sendEmailFnc.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['ses:SendEmail'],
            resources: ['*'],
        }));

        // Lambda notification log function
        const notificationLogFnc = new NodejsFunction(this, 'notificationLogFnc', {
            description: 'SES notifications log function',
            entry: `${__dirname}/lambda/notification-log/index.ts`,
            environment: {
                ...lambdaEnv,
            },
            logGroup: new LogGroup(this, 'notificationLogFncLogs', {
                retention: RetentionDays.ONE_MONTH,
            }),
            ...lambdaProps,
        });
        sesNotificationsTopic.addSubscription(new LambdaSubscription(notificationLogFnc));
        table.grantReadWriteData(notificationLogFnc);

        // Lambda Query log function
        const queryLogFnc = new NodejsFunction(this, 'queryLogFnc', {
            description: 'SES query log function',
            entry: `${__dirname}/lambda/query-log/index.ts`,
            environment: {
                UTC_OFFSET: utcOffset,
                DESTINATION_ID_INDEX: destinationIdIndexName,
                ...lambdaEnv,
            },
            logGroup: new LogGroup(this, 'queryLogFncLogs', {
                retention: RetentionDays.ONE_MONTH,
            }),
            ...lambdaProps,
        });
        table.grantReadData(queryLogFnc);

        // API ================================================================================================

        // API Policy - restrict access to the API by IP Address if required
        const sourceCidrs = (allowCidr.length) ? allowCidr : ['0.0.0.0/0'];
        const apiPolicy = new PolicyDocument({
            // allow access to API from allowed CIDRs
            statements: [
                new PolicyStatement({
                    principals: [new AnyPrincipal()],
                    actions: ['execute-api:Invoke'],
                    resources: ['execute-api:/*'],
                    effect: Effect.DENY,
                    conditions: {
                        NotIpAddress: {
                            'aws:SourceIp': sourceCidrs,
                        },
                    },
                }),
                new PolicyStatement({
                    principals: [new AnyPrincipal()],
                    actions: ['execute-api:Invoke'],
                    resources: ['execute-api:/*'],
                    effect: Effect.ALLOW,
                }),
            ],
        });

        // Create the API
        const api = new RestApi(this, `${appName}Api`, {
            restApiName: `${appName}Api`,
            description: `${appName} API`,
            deployOptions: {
                stageName: 'v1',
                description: 'V1 Deployment',
            },
            endpointTypes: [EndpointType.REGIONAL],
            policy: apiPolicy,
        });

        // Create an API custom domain and DNS records if required
        if (useCustomDomain) {
            // Lookup the DNS Zone
            const zone = HostedZone.fromHostedZoneAttributes(this, 'zone', { zoneName, hostedZoneId });
            const apiDomainName = `${apiHostname}.${zoneName}`;

            // Path for our email api from the base url
            const basePath = 'email';

            // Lookup or create the ACM certificate
            const certificate = (!certificateArn) ? new Certificate(this, 'cert', { domainName: `*.${zoneName}`, validation: CertificateValidation.fromDns(zone) }) : Certificate.fromCertificateArn(this, 'cert', certificateArn);

            // Create the API domain
            const apiDomain = new DomainName(this, 'apiDomain', {
                domainName: apiDomainName,
                certificate,
                endpointType: EndpointType.REGIONAL,
                securityPolicy: SecurityPolicy.TLS_1_2,
            });

            // Map the domain to the API
            new BasePathMapping(this, 'pathMapping', {
                basePath,
                domainName: apiDomain,
                restApi: api,
            });

            // Create an API DNS Alias
            new ARecord(this, 'apiAlias', {
                target: RecordTarget.fromAlias(new ApiGatewayDomain(apiDomain)),
                zone,
                recordName: apiDomainName,
            });

            // Output the URL
            new CfnOutput(this, 'customUrl', {
                description: 'API URL base path',
                value: `https://${apiDomainName}/${basePath}/`,
            });
        }

        // API Usage Plan - to attach the API Key or set a Quota
        const defUsagePlanProps: UsagePlanProps = {
            name: `${appName} Default Usage Plan`,
            apiStages: [{ api, stage: api.deploymentStage }],
            // Add daily quota if required. It is also possible to rate limit but it requires more thought.
            quota: (dailyQuota)
                ? {
                    limit: dailyQuota,
                    period: Period.DAY,
                }
                : undefined,
        };

        // Add API Key if required
        if (!allowCidr.length && !useApiKey) { console.log('WARNING: The API will be open to the public'); }
        if (useApiKey) {
            // Create a secret and generate key
            this.apiKeySecret = new Secret(this, `${appName}ApiKeySecret`, {
                description: `${appName} API Key`,
                generateSecretString: {
                    secretStringTemplate: JSON.stringify({
                        API_URL: api.url,
                    }),
                    generateStringKey: 'API_KEY',
                    excludePunctuation: true, // avoid using chars not valid in API keys
                },
            });
            // The key can be retrieved from the Secret
            new CfnOutput(this, 'apiKeySecretArn', {
                description: `${appName} API Key Arn`,
                value: this.apiKeySecret.secretArn,
            });
        }

        // Attach the Usage Plan to the API
        const usagePlan = new UsagePlan(this, 'defaultUsagePlan', defUsagePlanProps);

        // Create the API Key and attach to Usage Plan
        if (useApiKey) {
            usagePlan.addApiKey(new ApiKey(this, `${appName}ApiKey`, {
                description: `${appName} API Key`,
                value: this.apiKeySecret.secretValueFromJson('API_KEY').toString(),
                enabled: true,
            }));
        }

        // API Resources and Methods ========================================================================

        // Model for the integration Method Responses
        const responseModel = new Model(this, 'responseModel', {
            restApi: api,
            contentType: 'application/json',
            schema: {
                schema: JsonSchemaVersion.DRAFT7,
                title: 'JsonResponse',
                type: JsonSchemaType.OBJECT,
                properties: {
                    state: { type: JsonSchemaType.STRING },
                    greeting: { type: JsonSchemaType.STRING },
                },
            },
        });

        // Common Props for Methods
        const responseModels = {
            'application/json': responseModel,
        };
        const methodResponses = [
            {
                statusCode: '200',
                responseModels,
            },
            {
                statusCode: '400',
                responseModels,
            },
            {
                statusCode: '500',
                responseModels,
            },
        ];

        // Send Email Lambda Integration
        const sendEmailIntegration = new LambdaIntegration(sendEmailFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": $input.json('$'),
                    "context": {
                      "resourcePath" : "$context.resourcePath",
                      "requestId": "$context.requestId"
                    }
                }`,
            },
            integrationResponses: [
                {
                    statusCode: '200',
                },
                {
                    selectionPattern: '.*:400.*',
                    statusCode: '400',
                    responseTemplates: {
                        // Extract the message object from the errorMessage string so we can return JSON to the caller
                        'application/json': `#set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                        {
                          "message" : "$errorMessageObj.message",
                          "requestId" : "$errorMessageObj.requestId",
                          "sourceId" : "$errorMessageObj.sourceId"
                        }`,
                    },
                },
                {
                    selectionPattern: '.*:500.*',
                    statusCode: '500',
                    responseTemplates: {
                        'application/json': `#set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                        {
                          "message" : "Internal server error",
                          "requestId" : "$errorMessageObj.requestId",
                          "sourceId" : "$errorMessageObj.sourceId"
                        }`,
                    },
                },
            ],
        });

        // Send Email Endpoint
        const sendRoot = api.root.addResource('send');
        sendRoot.addMethod('POST', sendEmailIntegration, {
            methodResponses,
            apiKeyRequired: useApiKey,
        });

        // Query Log Lambda Integration
        // Query Integration common Props
        const queryIntegrationProps = {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "messageId": "$input.params('messageid')",
                        "destination": "$input.params('destination')",
                        "exclusiveStartKey": "$input.params('exclusivestartkey')"
                    },
                    "context": {
                      "resourcePath" : "$context.resourcePath",
                      "requestId": "$context.requestId"
                    }
                }`,
            },
            integrationResponses: [
                {
                    statusCode: '200',
                },
                {
                    selectionPattern: '.*:400.*',
                    statusCode: '400',
                    responseTemplates: {
                        'application/json': `#set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                        {
                          "message" : "$errorMessageObj.message",
                          "requestId" : "$errorMessageObj.requestId"
                        }`,
                    },
                },
                {
                    selectionPattern: '.*:500.*',
                    statusCode: '500',
                    responseTemplates: {
                        'application/json': `#set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                        {
                          "message" : "Internal server error",
                          "requestId" : "$errorMessageObj.requestId"
                        }`,
                    },
                },
            ],
        };

        // Query Log Lambda Integrations
        const queryMessageIdIntegration = new LambdaIntegration(queryLogFnc, {
            requestParameters: {
                'integration.request.path.messageid': 'method.request.path.messageid',
                'integration.request.querystring.exclusivestartkey': 'method.request.querystring.exclusivestartkey',
            },
            ...queryIntegrationProps,
        });
        const queryDestinationIntegration = new LambdaIntegration(queryLogFnc, {
            requestParameters: {
                'integration.request.path.destination': 'method.request.path.destination',
                'integration.request.querystring.exclusivestartkey': 'method.request.querystring.exclusivestartkey',
            },
            ...queryIntegrationProps,
        });

        // Query Log Endpoints
        const queryRoot = api.root.addResource('query');
        const messageIdRoot = queryRoot.addResource('message-id');
        const messageIdParam = messageIdRoot.addResource('{messageid}');
        messageIdParam.addMethod('GET', queryMessageIdIntegration, {
            methodResponses,
            requestParameters: {
                'method.request.path.messageid': true,
                'method.request.querystring.exclusivestartkey': false,
            },
            apiKeyRequired: useApiKey,
        });

        const destinationRoot = queryRoot.addResource('destination');
        const destinationParam = destinationRoot.addResource('{destination}');
        destinationParam.addMethod('GET', queryDestinationIntegration, {
            methodResponses,
            requestParameters: {
                'method.request.path.destination': true,
                'method.request.querystring.exclusivestartkey': false,
            },
            apiKeyRequired: useApiKey,
        });
    }
}
