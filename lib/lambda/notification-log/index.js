const { logs } = require('@local/utils');

/**
 * Get event details based on the event type
 * https://docs.aws.amazon.com/ses/latest/DeveloperGuide/event-publishing-retrieving-sns-contents.html
 * @param {object} message - the message from SNS
 */
function eventDetails(message) {
    const { mail, eventType } = message;
    const {
        open = {}, delivery = {}, reject = {}, bounce = {}, click = {}, complaint = {},
    } = message;

    const timestamp = {
        Notification: '',
        Send: mail.timestamp,
        Open: open.timestamp,
        Delivery: delivery.timestamp,
        Click: click.timestamp,
        Bounce: bounce.timestamp,
        Reject: reject.timestamp,
        Complaint: complaint.timestamp,
    };

    const destinations = {
        Notification: [],
        Send: mail.destination,
        Open: mail.destination,
        Delivery: delivery.recipients,
        Click: mail.destination,
        Bounce: (Object.keys(bounce).length) ? bounce.bouncedRecipients.map((recipient) => recipient.emailAddress) : [],
        Reject: mail.destination,
        Complaint: (Object.keys(complaint).length) ? complaint.bouncedRecipients.map((recipient) => recipient.emailAddress) : [], // This will contain all emails sent to the domain of the user who complained
    };

    const link = {
        Click: click.link,
    };

    const errorMessage = {
        Bounce: bounce.bounceType,
        Complaint: complaint.complaintSubType,
        Reject: reject.reason,
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
 * Expects an array of records from SNS
 * Logs are contained in the Sns.Message field
 * @param {object} context
 * @param {string} [context.requestId]
 * @param {object[]} Records
 * @param {object} Records[].Sns
 * @param {string} Records[].Sns.Message
 */
exports.handler = async (event) => {
    console.log('Event: ', JSON.stringify(event));
    try {
        const { Records } = event;
        if (!Array.isArray(Records) || !Records.length) { throw new Error('No records found in SNS event'); }
        const messageIds = await Promise.all(Records.map(async (record) => {
            const message = JSON.parse(record.Sns.Message);
            const { mail, eventType } = message;

            // console.log('EVENT TYPE: ', eventType.toUpperCase());
            // console.log('Message: ', JSON.stringify(message));

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
                requestId: record.MessageId,
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
        err.message = (err.message) || 'Internal error';
        console.log('Error caught: ', err);
        // TODO - we should be throwing an error here and handling with a DLQ
        return false;
    }
};
