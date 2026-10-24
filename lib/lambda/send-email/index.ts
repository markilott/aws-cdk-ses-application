import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { utils, logs, errors } from '@local/utils';

const { ValidationError, ApiError } = errors;

const ses = new SESv2Client();

const configSetName = process.env.CONFIGURATION_SET_NAME;
const defaultFrom = process.env.DEFAULT_FROM_ADDRESS;

// SES error codes where we will want to send a 400 response to the caller
// https://docs.aws.amazon.com/ses/latest/DeveloperGuide/using-ses-api-error-codes.html
const ses400Codes = ['MailFromDomainNotVerified', 'MessageRejected'];

type EventProps = {
    params?: {
        toAddress?: string,
        replyToAddresses?: string[],
        fromAddress?: string,
        subject?: string,
        messageText?: string,
        messageHtml?: string,
        sourceId?: string,
    },
    context?: {
        requestId?: string,
    },
};

/**
 * Receive API requests and send email via SES
 * It is possible to send to multiple addresses and include cc and bcc with a single call, however
 * this makes tracking individual messages very difficult.
 * We are limiting to a single toAddress so we get a unique messageId.
 */
export const handler = async (event: EventProps) => {
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
        timestamp: '',
        errorMessage: '',
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
        const Body: { Text?: { Data: string, Charset: string }, Html?: { Data: string, Charset: string } } = {};
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

        // Send the message
        result.timestamp = utils.getTimestamp();
        const { MessageId: messageId } = await ses.send(new SendEmailCommand({
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
            FromEmailAddress: fromAddress || defaultFrom,
        }));

        result.status = 'QUEUED';
        result.success = true;
        result.messageId = messageId || requestId;
        return result;
    } catch (err) {
        if (!(err instanceof Error)) { throw err; }
        console.log('Error caught: ', err);
        const errorCode = ('code' in err) ? String(err.code) : '';
        const statusCode = (err instanceof ValidationError || ses400Codes.includes(errorCode)) ? 400 : 500;
        result.errorMessage = err.message || 'Internal Error';
        throw new ApiError(result.errorMessage, statusCode, requestId, sourceId);
    } finally {
        // Write the result to the DynamoDb table
        await logs.writeLog({
            ...result,
            messageId: result.messageId || requestId,
        });
    }
};
