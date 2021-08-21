// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const { utils, logs, errors } = require('@local/utils');

const { ValidationError, ApiError } = errors;

const ses = new AWS.SESV2();

const configSetName = process.env.CONFIGURATION_SET_NAME;
const defaultFrom = process.env.DEFAULT_FROM_ADDRESS;

// SES error codes where we will want to send a 400 response to the caller
// https://docs.aws.amazon.com/ses/latest/DeveloperGuide/using-ses-api-error-codes.html
const ses400Codes = ['MailFromDomainNotVerified', 'MessageRejected'];

exports.handler = async (event) => {
    /**
     * Receive API requests and send email via SES
     * It is possible to send to multiple addresses and include cc and bcc with a single call, however
     * this makes tracking individual messages very difficult.
     * We are limiting to a single toAddress so we get a unique messageId.
     * @param {object} context
     * @param {string} [context.requestId]
     * @param {object} params
     * @param {string} params.toAddress
     * @param {string[]} [params.replyToAddresses]
     * @param {string} fromAddress - Must be an address on a verified domain
     * @param {string} subject
     * @param {string} messageText
     * @param {string} messageHtml
     * @param {string} [sourceId]
     */
    // console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const {
        toAddress = '', replyToAddresses = [], fromAddress = '', subject = '', messageText = '', messageHtml = '', sourceId = 'Not supplied',
    } = params;
    const { requestId = 'Unknown' } = context;
    const result = {
        success: false,
        messageId: '',
        status: 'ERROR',
        requestId,
        sourceId,
        destination: toAddress,
    };

    try {
        if (!toAddress) { throw new ValidationError('toAddress is required'); }
        if (!subject) { throw new ValidationError('subject is required'); }
        if (!messageHtml && !messageText) { throw new ValidationError('Either messageText or messageHtml is required'); }

        // Validate all addresses
        const allEmails = [...replyToAddresses, toAddress, fromAddress];
        allEmails.forEach((email) => {
            if (email && !utils.isValidEmail(email)) { throw new ValidationError(`Invalid email address: ${email}`); }
        });

        // Email body
        const Body = {};
        if (messageText) {
            Body.Text = {
                Data: messageText,
                Charset: 'UTF-8',
            };
        }
        if (messageHtml) {
            Body.Html = {
                Data: messageHtml,
                Charset: 'UTF-8',
            };
        }

        // Email params
        const emailParams = {
            Content: {
                Simple: {
                    Body,
                    Subject: {
                        Data: subject,
                        Charset: 'UTF-8',
                    },
                },
            },
            ConfigurationSetName: configSetName,
            Destination: {
                ToAddresses: [toAddress],
            },
            FromEmailAddress: (fromAddress) || defaultFrom,
        };
        // console.log('Email params: ', JSON.stringify(emailParams));

        // Send the message
        result.timestamp = utils.getTimestamp();
        const { MessageId: messageId } = await ses.sendEmail(emailParams).promise();

        result.status = 'QUEUED';
        result.success = true;
        result.messageId = messageId;
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal Error';
        console.log('Error caught: ', err);
        const statusCode = (err instanceof ValidationError || ses400Codes.includes(err.code)) ? 400 : 500;
        result.errorMessage = err.message;
        throw new ApiError(err.message, statusCode, requestId, sourceId);
    } finally {
        // Write the result to the DynamoDb table
        await logs.writeLog({
            ...result,
            messageId: (result.messageId) || requestId,
        });
    }
};
