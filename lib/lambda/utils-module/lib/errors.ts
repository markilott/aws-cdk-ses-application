/**
 * Error object for 400 type errors
 */
export class ValidationError extends Error {
    constructor(message: string) {
        super(`Validation Error: ${message}`);
        this.name = this.constructor.name;
    }
}

/**
 * Error object to return to API Gateway
 */
export class ApiError extends Error {
    constructor(message: string, code = 0, requestId = '', sourceId = '') {
        const statusCode = code || 500;
        const msgObj: {
            success: boolean,
            statusCode: number,
            message: string,
            requestId?: string,
            sourceId?: string,
        } = {
            success: false,
            statusCode,
            message,
        };
        if (requestId) { msgObj.requestId = requestId; }
        if (sourceId) { msgObj.sourceId = sourceId; }
        super(JSON.stringify(msgObj));
        this.name = this.constructor.name;
    }
}
