const { logs, errors, utils } = require('@local/utils');

const { ValidationError, ApiError } = errors;

exports.handler = async (event) => {
    /**
     * Query API handler
     * @param {object} params
     * @param {string} [params.messageId]
     * @param {string} [params.destination]
     * @param {string} [params.exclusiveStartKey]
     * @param {object} context
     * @param {string} context.resourcePath
     * @param {string} [context.requestId]
     */
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
            exclusiveStartKey: (exclusiveStartKey) ? JSON.parse(decodeURIComponent(exclusiveStartKey)) : '',
        };

        if (query === 'destination' && !utils.isValidEmail(queryParams.destination)) { throw new ValidationError('A valid email address destination is required'); }

        // Run the query
        let response;
        if (query === 'messageId') { response = await logs.queryMessageId(queryParams); }
        if (query === 'destination') { response = await logs.queryDestination(queryParams); }

        if (!response.success) { throw new ValidationError(response.message); }

        return {
            ...response,
            requestId,
        };
    } catch (err) {
        err.message = (err.message) || 'Internal handler error';
        console.log('Error caught: ', err);
        const statusCode = (err instanceof ValidationError) ? 400 : 500;
        throw new ApiError(err.message, statusCode, requestId);
    }
};
