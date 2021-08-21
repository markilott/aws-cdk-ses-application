const moment = require('moment');
const { validate } = require('email-validator');

function isValidEmail(email) {
    /**
     * Validate the email address
     * @param {string} email
     */
    return validate(email);
}

function getTimestamp(time) {
    /**
     * Get ISO String timestamp with milliseconds
     * @param {string} [time]
     */
    return (time) ? moment(time).toISOString() : moment().toISOString();
}

module.exports = { isValidEmail, getTimestamp };
