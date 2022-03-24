/**
 * Will deploy into the current default CLI account.
 *
 * Deployment:
 * cdk deploy --all
 */

/* eslint-disable no-new */
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { SesApplicationStack } from '../lib/application-stack';
import { SesConfigStack } from '../lib/ses-config-stack';
import { appAttr, sesAttr, domainAttr } from '../config';

const app = new App();

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
