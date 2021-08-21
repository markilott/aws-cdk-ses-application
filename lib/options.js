const domainAttr = {
    configureDomain: true, // Set to false if your domain is already configured in SES
    // zoneName for the email domain is required (even if not configuring the domain now). hostedZoneId for a Route53 domain is optional.
    zoneName: 'dev.occasional.cloud',
    hostedZoneId: 'Z08395023U6GAULHU3P80',
    apiHostname: 'email-api', // Use custom api domain name. Requires the Route53 domain hostedZoneId
    certificateArn: 'arn:aws:acm:ap-southeast-1:532634703125:certificate/6fc48374-ea2a-46a0-bcef-1c65ae54799b', // Leave blank to create a new certificate for the custom api domain
};

const sesAttr = {
    // Email addresses to subscribe to SNS topic for bounce/complaint notifications (if we are configuring the SES domain)
    notifList: [
        'mark@occasional.cloud',
    ],
};

const appAttr = {
    appName: 'sesTestApp',
    utcOffset: '+07:00', // Used to return local time in log queries
    defaultFrom: 'do-not-reply',
    // Email addresses will be added to the verified list and will be sent a confirmation email
    emailList: [
        'mark@occasional.cloud',
        'mark@mingcom.com.au',
        'm1@mingcom.com.au',
    ],
    useApiKey: true, // Use an API Key to secure the API
    allowCidr: [], // White list for the API. Leave empty to allow all
    dailyQuota: 1000, // Daily request quota for the API. Set to zero to make it unrestricted
    logExpiry: 30, // DynamoDb TTL Expiry in days
};

module.exports = { sesAttr, domainAttr, appAttr };
