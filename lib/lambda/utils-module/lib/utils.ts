import { validate } from 'email-validator';

/**
 * Validate the email address
 */
export function isValidEmail(email: string): boolean {
    return validate(email);
}

/**
 * Get ISO String timestamp with milliseconds
 */
export function getTimestamp(time?: string): string {
    return (time) ? new Date(time).toISOString() : new Date().toISOString();
}
