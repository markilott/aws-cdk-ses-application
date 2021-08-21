# AWS CDK SES Email App

This Javascript CDK project creates an API and application for sending email via SES, including tracking and logging in DynamoDb.

Optionally it will also confgure the required domain in SES if it is not already setup.

CDK Custom Resources are used to configure SES and add verified email addresses.

The full application creates:
- A verified SES domain and email address identities
- Lambda functions to send email, log status to DynamoDb, and query the log table
- A DynamoDb table for the email tracking logs
- An API for sending email and querying logs

A more detailed explanation is available [in this Medium article](https://markilott.medium.com/send-and-track-email-with-aws-ses-dc783fd6f5fc).

&nbsp;

## Requirements

- A domain you can modify, or you have already set up in SES.
- A Route53 Domain in the target Account is required for fully automated setup. Domain records can be manually added to an external domain if none is available in the Account.

&nbsp;

## Setup

Assuming you have the AWS CLI and CDK installed and configured already...

Setup the project:
- Clone the repo
- run `npm install`
- Update the `lib/options.js` file with your own preferences
- run `npm run build` (use Git Bash or other Linux shell on Windows)

&nbsp;

## Options

Domain Options:
- `domainAttr.configureDomain` - optionally configure the domain in SES.
- `domainAttr.zoneName` - required - the Zone Name (the domain name you will be verifying).
- `domainAttr.hostedZoneId` - required for automated setup and for a custom API URL - the Route53 Zone Id for the domain.
- `domainAttr.apiHostname` - optional - the hostname for a custom API URL. If blank the custom URL will not be created.
- `domainAttr.certificateArn` - optional - ARN for a wildcard certificate on the domain. If blank and we are creating a custom URL then a Certificate will be created.

SES Options (if we are configuring the domain in SES):
- `sesAttr.notifList` - a list of email addresses to be attached to the default SNS notification topic. These will receive notifications of email bounces and rejects that are not sent through our app.

App Options:
- `appAttr.appName` - required - used to endure the CloudFormation resource names are unique and identifiable.
- `appAttr.utcOffset` - required - your local timezone - used in log queries.
- `appAttr.defaultFrom` - required - the default prefix for the email from address (can be overridden in the API)
- `appAttr.emailList` - optional - email addresses to verify for sending. You either need to verify emails or move the account into production mode to be able to send email. These do not need to be on the verified domain, you just need to be able to receive emails to them so you can click the verify link.
- `appAttr.useApiKey` - optional - use an API Key to authenticate to the API.
- `appAttr.allowCidr` - optional - a list of allowed CIDR ranges to use the API (eg. '200.100.10.10/32'). If you do not specify an API Key or CIDR ranges then the API will be open to the public.
- `appAttr.dailyQuota` - optional - a daily request quota for the API. Used to provide a safety limit.
- `appAttr.logExpiry` - optional - logs will be deleted from DynamoDb after this time. Blank or zero = no expiry.

&nbsp;

## Manual Domain Verification

If you are configuring the SES domain:
- If you are not using a local Route53 domain then you must manually verify the external domain by adding DKIM records.
- The 3 required DKIM records are output by the CloudFormation template
- DKIM verification typically takes 10-15mins but can be longer

The records are entered as CNAMES, like this:

`67ku2xjbm6yqupbfsdh3w7lhtmmabcdef._domainkey.mydomain.com CNAME 67ku2xjbm6yqupbfsdh3w7lhtmmabcdef.dkim.amazonses.com`

&nbsp;

## Deployment

Use CDK to deploy:
`cdk deploy --all`

&nbsp;

## Testing SES Setup

SES messaging is in sandbox mode by default. You will only be able to send email to addresses you have verified until you apply to move to production mode.

***Note the following:***
- You can use any address @ your verified SES domain as the from address
- The destination must be one of the verified email addresses you added

To send an email test from the CLI:

```shell
aws sesv2 send-email \
  --from-email-address "no-reply@mydomain.com" \
  --destination "ToAddresses=me@mydomain.com" \
  --content "Simple={Subject={Data=Hello World,Charset=utf8},Body={Text={Data=Hi from SES,Charset=utf8},Html={Data=<p>Hi from SES<p>,Charset=utf8}}}"
```

## Testing the API

### Send an email:

```shell
curl --location --request POST 'https://mydomain.com/email/send' \
--header 'X-Api-Key: abcdef123abcdef' \
--header 'Content-Type: application/json' \
--data-raw '{
    "toAddress": "[Required] me@mydomain.com",
    "subject": "[Required] Test message",
    "messageText": "[Optional] Test message",
    "messageHtml": "[Required for email tracking] <p>Test message</p>",
    "fromAddress": "[Optional] no-reply@mydomain.com",
    "sourceId": "[Optional] source reference Id"
}'
```

Expected response (`Status: 200`):

```json
{
    "success": true,
    "messageId": "abcdef123456-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000",
    "status": "QUEUED",
    "requestId": "f1c3233e-a75c-45c0-a55f-7b67169cb24d",
    "sourceId": "Source reference Id if provided",
    "destination": "me@mydomain.com",
    "timestamp": "2021-08-15T09:42:32.383Z"
}
```

Example Error response (`Status: 400`):

```json
{
    "message": "Validation Error: subject is required",
    "requestId": "97589ce2-04e0-43df-92f1-ba630e45b040",
    "sourceId": "Source reference Id if provided"
}
```

### Query by MessageId:

```shell
curl --location --request GET 'https://mydomain.com/email/query/message-id/abcdef123456-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000' \
--header 'X-Api-Key: abcdef123abcdef'
```

### Query by Email address:

```shell
curl --location --request GET 'https://mydomain.com/email/query/destination/me@mydomain.com' \
--header 'X-Api-Key: abcdef123abcdef'
```

### Example query responses:

Success (`Status: 200`):

```json
{
    "success": true,
    "data": [
        {
            "RequestId": "",
            "SourceId": "",
            "LogStatus": "OPEN",
            "MessageId": "010e017b4930ff2e-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000",
            "LogTime": "2021-08-15T09:43:07.205Z",
            "Destination": "me@mydomain.com",
            "ExpiryTime": 1631612587,
            "LocalTime": "15 Aug 2021, 16:43:07.205 +07:00"
        },
        {
            "RequestId": "",
            "SourceId": "",
            "LogStatus": "DELIVERY",
            "MessageId": "010e017b4930ff2e-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000",
            "LogTime": "2021-08-15T09:42:35.755Z",
            "Destination": "me@mydomain.com",
            "ExpiryTime": 1631612555,
            "LocalTime": "15 Aug 2021, 16:42:35.755 +07:00"
        },
        {
            "RequestId": "",
            "SourceId": "",
            "LogStatus": "SEND",
            "MessageId": "010e017b4930ff2e-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000",
            "LogTime": "2021-08-15T09:42:33.006Z",
            "Destination": "me@mydomain.com",
            "ExpiryTime": 1631612554,
            "LocalTime": "15 Aug 2021, 16:42:33.006 +07:00"
        },
        {
            "RequestId": "f1c3233e-a75c-45c0-a55f-7b67169cb24d",
            "SourceId": "6e783647-d103-4ba4-a396-1431dbb44988",
            "LogStatus": "QUEUED",
            "MessageId": "010e017b4930ff2e-47dd6bb2-9da2-4159-8404-9bb415dcb2ec-000000",
            "LogTime": "2021-08-15T09:42:32.383Z",
            "Destination": "me@mydomain.com",
            "ExpiryTime": 1631612553,
            "LocalTime": "15 Aug 2021, 16:42:32.383 +07:00"
        }
    ],
    "requestId": "97589ce2-04e0-43df-92f1-ba630e45b040"
}
```

If the result is paginated the response will include:

```json
{
    // ... //
    "morePages": true,
    "lastEvaluatedKey": {
        // DynamoDb LastEvaluatedKey object
    }
}
```

To retrieve the next page, include the ExclusiveStartKey query param in the next request:

`?exclusivestartkey="Stringified DynamoDb ExclusiveStartKey object"`

See the DynamoDb docs for more information on pagination.

&nbsp;

Example empty response (`Status: 400`):

```json
{
    "success": false,
    "data": [],
    "message": "Validation Error: No results found",
    "requestId": "97589ce2-04e0-43df-92f1-ba630e45b040"
}
```

Example Error response (`Status: 400`):

```json
{
    "success": false,
    "message": "Validation Error: A valid email address destination is required",
    "requestId": "97589ce2-04e0-43df-92f1-ba630e45b040",
}
```

&nbsp;

## Costs and Cleanup

If you are using an API Key then a Secrets Manager secret will be created that costs ~$1/month.

Other than that everything will be within free tiers unless you manage to send tens of thousands of emails per month.

Use `cdk destroy` or delete the CloudFormation stacks.

All of the configuration and verified emails and subscriptions will be deleted, along with the DynamoDb table and all logs.
