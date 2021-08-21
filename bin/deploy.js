/**
 * Will deploy into the current default CLI account.
 *
 * Deployment:
 * cdk deploy --all
 */

/* eslint-disable no-new */
const cdk = require('@aws-cdk/core');
const { SesApplicationStack } = require('../lib/application-stack');
const { SesConfigStack } = require('../lib/ses-config-stack');
const { appAttr, sesAttr, domainAttr } = require('../lib/options');

const app = new cdk.App();

// Use account details from default AWS CLI credentials:
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const env = { account, region };

// Create SES Configuration Stack
if (domainAttr.configureDomain) {
    new SesConfigStack(app, 'SesConfigStack', {
        description: 'SES Domain Configuration Stack',
        env,
        sesAttr,
        domainAttr,
    });
}

// Create Application Stack
new SesApplicationStack(app, 'SesApplicationStack', {
    description: 'SES Email Application Stack',
    env,
    appAttr,
    domainAttr,
});
