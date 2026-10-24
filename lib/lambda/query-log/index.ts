import { logs, errors, utils } from '@local/utils';

const { ValidationError, ApiError } = errors;

type EventProps = {
    params?: {
        messageId?: string,
        destination?: string,
        exclusiveStartKey?: string,
    },
    context?: {
        resourcePath?: string,
        requestId?: string,
    },
};

/**
 * Query API handler
 */
export const handler = async (event: EventProps) => {
    console.log('Event: ', JSON.stringify(event));
    const { params = {}, context = {} } = event;
    const { messageId = '', destination = '', exclusiveStartKey = '' } = params;
    const { resourcePath = '', requestId = 'Unknown' } = context;

    try {
        // Query types
        let query = '';
        if (resourcePath.includes('message-id')) { query = 'messageId'; }
        if (resourcePath.includes('destination')) { query = 'destination'; }

        if (!query) { throw new Error('Invalid Path'); }
        if (query === 'messageId' && !messageId) { throw new ValidationError('messageId parameter is required'); }
        if (query === 'destination' && !destination) { throw new ValidationError('destination parameter is required'); }

        // Query params
        const queryParams = {
            messageId: decodeURIComponent(messageId),
            destination: decodeURIComponent(destination),
            exclusiveStartKey: (exclusiveStartKey) ? JSON.parse(decodeURIComponent(exclusiveStartKey)) : {},
        };

        if (query === 'destination' && !utils.isValidEmail(queryParams.destination)) { throw new ValidationError('A valid email address destination is required'); }

        // Run the query
        let response;
        if (query === 'messageId') { response = await logs.queryMessageId(queryParams); }
        if (query === 'destination') { response = await logs.queryDestination(queryParams); }

        if (!response) { throw new Error('Unexpected query result'); }
        if (!response.success) { throw new ValidationError(response.message); }

        return {
            ...response,
            requestId,
        };
    } catch (err) {
        if (!(err instanceof Error)) { throw err; }
        console.log('Error caught: ', err);
        const statusCode = (err instanceof ValidationError) ? 400 : 500;
        throw new ApiError(err.message || 'Internal handler error', statusCode, requestId);
    }
};
