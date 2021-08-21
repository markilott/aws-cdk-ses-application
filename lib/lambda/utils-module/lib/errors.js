/* eslint-disable max-classes-per-file */
class ValidationError extends Error {
    /**
     * Error object for 400 type errors
     * @param {string} message
     */
    constructor(message, ...params) {
        super(...params);
        this.name = this.constructor.name;
        this.message = `Validation Error: ${message}`;
    }
}

class ApiError extends Error {
    /**
     * Error object to return to API Gateway
     * @param {string} message
     * @param {integer} [code = 500]
     * @param {string} [requestId]
     * @param {string} [sourceId]
     */
    constructor(message, code = 0, requestId = '', sourceId = '', ...params) {
        super(...params);
        this.name = this.constructor.name;
        const statusCode = (code) || 500;
        const msgObj = {
            success: false,
            statusCode,
            message,
        };
        if (requestId) { msgObj.requestId = requestId; }
        if (sourceId) { msgObj.sourceId = sourceId; }
        this.message = JSON.stringify(msgObj);
    }
}

module.exports = { ValidationError, ApiError };
