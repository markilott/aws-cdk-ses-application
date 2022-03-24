const moment = require('moment');
const { validate } = require('email-validator');

/**
 * Validate the email address
 * @param {string} email
 */
function isValidEmail(email) {
    return validate(email);
}

/**
 * Get ISO String timestamp with milliseconds
 * @param {string} [time]
 */
function getTimestamp(time) {
    return (time) ? moment(time).toISOString() : moment().toISOString();
}

module.exports = { isValidEmail, getTimestamp };
