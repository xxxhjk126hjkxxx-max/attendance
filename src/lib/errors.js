'use strict';

/** Application errors carry an HTTP status and optional field-level details. */
class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = options.code || null;
    this.fields = options.fields || null;
    this.details = options.details || null;
  }
}

const badRequest = (message, fields) => new AppError(400, message, { fields });
const unauthorized = (message = 'Authentication required. Please sign in again.') => new AppError(401, message);
const forbidden = (message = 'You do not have permission to perform this action.') => new AppError(403, message);
const notFound = (message = 'The requested resource was not found.') => new AppError(404, message);
const conflict = (message, fields) => new AppError(409, message, { fields });
const unprocessable = (message, fields) => new AppError(422, message, { fields });
const tooMany = (message, retryAfter) => new AppError(429, message, { details: { retryAfter } });

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, tooMany };
