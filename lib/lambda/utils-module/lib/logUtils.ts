import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DateTime } from 'luxon';
import { getTimestamp } from './utils';

const logTbl = process.env.LOG_TABLE_NAME;
const destinationIdIndex = process.env.DESTINATION_ID_INDEX;
const logExpiry = Number(process.env.LOG_EXPIRY);
const utcOffset = process.env.UTC_OFFSET;

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION,
}));

export type LogItem = {
    MessageId: string,
    RequestId: string,
    Destination: string,
    SourceId: string,
    LogTime: string,
    LogStatus: string,
    ExpiryTime?: number,
    Link?: string,
    ErrorMessage?: string,
    LocalTime?: string,
};

type WriteLogProps = {
    messageId?: string,
    destination?: string,
    sourceId?: string,
    status?: string,
    requestId?: string,
    timestamp?: string,
    link?: string,
    errorMessage?: string,
};

/**
 * Write sent message logs to DynamoDb
 */
export async function writeLog({
    messageId = '', destination = '', sourceId = '', status = '', requestId = '', timestamp = '', link = '', errorMessage = '',
}: WriteLogProps): Promise<boolean> {
    try {
        if (!destination) { throw new Error('destination is required'); }
        if (!messageId) { throw new Error('messageId is required'); }

        // Set up log params
        const item: LogItem = {
            MessageId: messageId,
            RequestId: requestId,
            Destination: destination,
            SourceId: sourceId,
            LogTime: getTimestamp(timestamp),
            LogStatus: (status) ? status.toUpperCase() : 'ERROR',
        };
        // Unix timestamp (seconds) for the DynamoDb TTL, logExpiry days from now
        if (logExpiry) { item.ExpiryTime = Math.floor((Date.now() + logExpiry * 24 * 60 * 60 * 1000) / 1000); }
        if (link) { item.Link = link; }
        if (errorMessage) { item.ErrorMessage = errorMessage; }

        // Write to DynamoDb
        const response = await docClient.send(new PutCommand({
            TableName: logTbl,
            Item: item,
        }));
        console.log('Ddb response: ', JSON.stringify(response));
        return true;
    } catch (err) {
        console.log('Error caught: ', err);
        return false;
    }
}

// Query Functions =====================================================================================================

/**
 * Convert time to local time for display.
 * Uses luxon as this needs a fixed UTC offset (not a named timezone) and a
 * custom format - not something native Date can do cleanly on its own.
 */
const localTime = (dateTime: string): string => DateTime.fromISO(dateTime, { zone: 'utc' })
    .setZone(`UTC${utcOffset}`)
    .toFormat('dd MMM yyyy, HH:mm:ss.SSS ZZ');

/**
 * Adds LocalTime field to query results
 */
function addLocal(data: LogItem[]): LogItem[] {
    return data.map((item) => ({
        ...item,
        LocalTime: localTime(item.LogTime),
    }));
}

type QueryResult = {
    success: boolean,
    data: LogItem[],
    message: string,
    lastEvaluatedKey?: Record<string, unknown>,
    morePages?: boolean,
};

/**
 * Run the query and return std result object
 */
async function runQuery(params: ConstructorParameters<typeof QueryCommand>[0]): Promise<QueryResult> {
    const result: QueryResult = {
        success: false,
        data: [],
        message: '',
    };
    try {
        const response = await docClient.send(new QueryCommand(params));

        if (!response.Items || !response.Items.length) {
            result.success = false;
            result.message = 'No results found';
            return result;
        }
        if (response.LastEvaluatedKey) {
            result.lastEvaluatedKey = response.LastEvaluatedKey;
            result.morePages = true;
        }
        result.data = addLocal(response.Items as LogItem[]);
        result.success = true;
        return result;
    } catch (err) {
        console.log('Error caught: ', err);
        throw err;
    }
}

/**
 * Get logs by MessageId
 */
export async function queryMessageId({
    messageId = '', exclusiveStartKey = {},
}: { messageId?: string, exclusiveStartKey?: Record<string, unknown> }): Promise<QueryResult> {
    try {
        const params: ConstructorParameters<typeof QueryCommand>[0] = {
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
        console.log('queryMessageId Error: ', err);
        throw err;
    }
}

/**
 * Get logs by destinationId
 */
export async function queryDestination({
    destination = '', exclusiveStartKey = {},
}: { destination?: string, exclusiveStartKey?: Record<string, unknown> }): Promise<QueryResult> {
    try {
        const params: ConstructorParameters<typeof QueryCommand>[0] = {
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
        console.log('queryDestinationId Error: ', err);
        throw err;
    }
}
