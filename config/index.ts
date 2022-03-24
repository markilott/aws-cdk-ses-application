export const domainAttr = {
    configureDomain: true, // Set to false if your domain is already configured in SES
    // zoneName for the email domain is required (even if not configuring the domain now). hostedZoneId for a Route53 domain is optional.
    zoneName: 'mydomain.com',
    hostedZoneId: '',
    apiHostname: 'email-api', // Use custom api domain name. Requires the Route53 domain hostedZoneId
    certificateArn: '', // Leave blank to create a new certificate for the custom api domain
};

export const sesAttr = {
    // Email addresses to subscribe to SNS topic for bounce/complaint notifications (if we are configuring the SES domain)
    notifList: [
        'me@mydomain.com',
    ],
};

export const appAttr = {
    appName: 'sesTestApp',
    utcOffset: '+07:00', // Used to return local time in log queries
    defaultFrom: 'do-not-reply',
    // Email addresses will be added to the verified list and will be sent a confirmation email
    emailList: [],
    useApiKey: true, // Use an API Key to secure the API
    allowCidr: [], // White list for the API. Leave empty to allow all
    dailyQuota: 1000, // Daily request quota for the API. Set to zero to make it unrestricted
    logExpiry: 30, // DynamoDb TTL Expiry in days
};
