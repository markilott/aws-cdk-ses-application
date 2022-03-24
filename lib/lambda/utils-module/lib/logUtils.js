// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const moment = require('moment');
const { getTimestamp } = require('./utils');

const logTbl = process.env.LOG_TABLE_NAME;
const destinationIdIndex = process.env.DESTINATION_ID_INDEX;
const logExpiry = Number(process.env.LOG_EXPIRY);
const utcOffset = process.env.UTC_OFFSET;

const docClient = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION,
});

/**
 * Write sent message logs to DynamoDb
 * @param {string} messageId
 * @param {string} destination
 * @param {string} [sourceId]
 * @param {string} [status]
 * @param {string} [requestId]
 * @param {string} [timestamp]
 * @param {string} [link]
 * @param {string} [errorMessage]
 */
async function writeLog({
    messageId = '', destination = '', sourceId = '', status = '', requestId = '', timestamp = '', link = '', errorMessage = '',
}) {
    try {
        if (!destination) { throw new Error('destination is required'); }
        if (!messageId) { throw new Error('messageId is required'); }

        // Set up log params
        const params = {
            TableName: logTbl,
            Item: {
                MessageId: messageId,
                RequestId: requestId,
                Destination: destination,
                SourceId: sourceId,
                LogTime: getTimestamp(timestamp),
                LogStatus: (status) ? status.toUpperCase() : 'ERROR',
            },
        };
        if (logExpiry) { params.Item.ExpiryTime = moment().add(logExpiry, 'd').format('X'); }
        if (link) { params.Item.Link = link; }
        if (errorMessage) { params.Item.ErrorMessage = errorMessage; }

        // Write to DynamoDb
        const response = await docClient.put(params).promise();
        console.log('Ddb response: ', JSON.stringify(response));
        return true;
    } catch (err) {
        err.message = (err.message) || 'Internal Error';
        console.log('Error caught: ', err);
        return false;
    }
}

// Query Functions =====================================================================================================

/**
 * Convert time to local time for display
 */
const localTime = (dateTime) => moment(dateTime).utcOffset(utcOffset).format('DD MMM YYYY, HH:mm:ss.SSS Z');

/**
 * Adds LocalTime field to query results
 */
function addLocal(data) {
    return data.map((item) => {
        const newItem = item;
        newItem.LocalTime = localTime(item.LogTime);
        return newItem;
    });
}

/**
 * Run the query and return std result object
 */
async function runQuery(params) {
    const result = {
        success: false,
        data: [],
        message: '',
    };
    try {
        const response = await docClient.query(params).promise();

        // console.log('Query result: ', JSON.stringify(response));

        if (!Array.isArray(response.Items) || !response.Items.length) {
            result.success = false;
            result.message = 'No results found';
            return result;
        }
        if (response.LastEvaluatedKey) {
            result.lastEvaluatedKey = response.LastEvaluatedKey;
            result.morePages = true;
        }
        result.data = addLocal(response.Items);
        result.success = true;
        return result;
    } catch (err) {
        err.message = (err.message) || 'Internal runQuery Error';
        throw err;
    }
}

/**
 * Get logs by MessageId
 * @param {string} messageId
 * @param {object} [exclusiveStartKey]
 */
async function queryMessageId({ messageId = '', exclusiveStartKey = {} }) {
    try {
        const params = {
            TableName: logTbl,
            KeyConditionExpression: 'MessageId = :id',
            ExpressionAttributeValues: {
                ':id': messageId,
            },
            ScanIndexForward: false,
        };
        if (Object.keys(exclusiveStartKey).length) { params.ExclusiveStartKey = exclusiveStartKey; }
        return await runQuery(params);
    } catch (err) {
        err.message = (err.message) || 'Internal query Error';
        console.log('queryMessageId Error: ', JSON.stringify(err));
        throw err;
    }
}

/**
 * Get logs by destinationId
 * @param {string} destination
 * @param {object} [exclusiveStartKey]
 */
async function queryDestination({ destination = '', exclusiveStartKey = {} }) {
    try {
        const params = {
            TableName: logTbl,
            IndexName: destinationIdIndex,
            KeyConditionExpression: 'Destination = :id',
            ExpressionAttributeValues: {
                ':id': destination,
            },
            ScanIndexForward: false,
        };
        if (Object.keys(exclusiveStartKey).length) { params.ExclusiveStartKey = exclusiveStartKey; }
        return await runQuery(params);
    } catch (err) {
        err.message = (err.message) || 'Internal query Error';
        console.log('queryDestinationId Error: ', JSON.stringify(err));
        throw err;
    }
}

module.exports = { writeLog, queryMessageId, queryDestination };
