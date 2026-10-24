import { SNSEvent } from 'aws-lambda';
import { logs } from '@local/utils';

type SesMailEvent = {
    eventType: string,
    mail: {
        timestamp: string,
        destination: string[],
        messageId: string,
    },
    open?: { timestamp: string },
    delivery?: { timestamp: string, recipients: string[] },
    reject?: { timestamp: string, reason: string },
    bounce?: { timestamp: string, bounceType: string, bouncedRecipients: { emailAddress: string }[] },
    click?: { timestamp: string, link: string },
    complaint?: { timestamp: string, complaintSubType: string, bouncedRecipients: { emailAddress: string }[] },
};

/**
 * Get event details based on the event type
 * https://docs.aws.amazon.com/ses/latest/DeveloperGuide/event-publishing-retrieving-sns-contents.html
 */
function eventDetails(message: SesMailEvent) {
    const { mail, eventType } = message;
    const {
        open = {} as SesMailEvent['open'], delivery = {} as SesMailEvent['delivery'], reject = {} as SesMailEvent['reject'],
        bounce = {} as SesMailEvent['bounce'], click = {} as SesMailEvent['click'], complaint = {} as SesMailEvent['complaint'],
    } = message;

    const timestamp: Record<string, string | undefined> = {
        Notification: '',
        Send: mail.timestamp,
        Open: open?.timestamp,
        Delivery: delivery?.timestamp,
        Click: click?.timestamp,
        Bounce: bounce?.timestamp,
        Reject: reject?.timestamp,
        Complaint: complaint?.timestamp,
    };

    const destinations: Record<string, string[] | undefined> = {
        Notification: [],
        Send: mail.destination,
        Open: mail.destination,
        Delivery: delivery?.recipients,
        Click: mail.destination,
        Bounce: (bounce && Object.keys(bounce).length) ? bounce.bouncedRecipients.map((recipient) => recipient.emailAddress) : [],
        Reject: mail.destination,
        Complaint: (complaint && Object.keys(complaint).length) ? complaint.bouncedRecipients.map((recipient) => recipient.emailAddress) : [], // This will contain all emails sent to the domain of the user who complained
    };

    const link: Record<string, string | undefined> = {
        Click: click?.link,
    };

    const errorMessage: Record<string, string | undefined> = {
        Bounce: bounce?.bounceType,
        Complaint: complaint?.complaintSubType,
        Reject: reject?.reason,
    };

    // Return details for the eventType
    return {
        timestamp: timestamp[eventType] ?? '',
        destinations: destinations[eventType] ?? [],
        link: link[eventType] ?? '',
        errorMessage: errorMessage[eventType] ?? '',
    };
}

/**
 * Take SES emails logs from SNS and write to log table
 * Expects an array of records from SNS. Logs are contained in the Sns.Message field
 */
export const handler = async (event: SNSEvent) => {
    console.log('Event: ', JSON.stringify(event));
    try {
        const { Records } = event;
        if (!Array.isArray(Records) || !Records.length) { throw new Error('No records found in SNS event'); }
        const messageIds = await Promise.all(Records.map(async (record) => {
            const message = JSON.parse(record.Sns.Message) as SesMailEvent;
            const { mail, eventType } = message;

            const { messageId = '' } = mail;
            if (!messageId) { throw new Error('Missing messageId'); }

            // Get event details
            const {
                destinations, timestamp, link, errorMessage,
            } = eventDetails(message);
            if (!destinations.length) { throw new Error('Did not find any destinations'); }
            if (!timestamp) { throw new Error(`Unknown eventType: ${eventType}`); }

            // Write to log
            await logs.writeLog({
                messageId,
                requestId: record.Sns.MessageId,
                status: eventType.toUpperCase(),
                destination: destinations[0], // We are only expecing one destination based on our send single email function.
                timestamp,
                link,
                errorMessage,
            });
            return messageId;
        }));
        console.log('Logged SNS messages: ', JSON.stringify(messageIds));
        return true;
    } catch (err) {
        console.log('Error caught: ', err);
        // TODO - we should be throwing an error here and handling with a DLQ
        return false;
    }
};
