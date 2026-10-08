/** Errors raised by the YTAPI client. The API body is `{"error": {"code", "message", "retryable"}}`. */

/** Base error. `status` is the HTTP status, or 0 for a network error. */
export class YTAPIError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      retryable?: boolean;
      retryAfter?: number;
    },
  ) {
    super(message);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.retryAfter = options.retryAfter;
  }
}

/** 401. The API key is missing or rejected. */
export class AuthError extends YTAPIError {}

/** 402. The credit balance cannot cover the call. */
export class InsufficientCreditsError extends YTAPIError {}

/** 404. `code` is captions_disabled, language_not_found, video_unavailable, or another not-found code. */
export class NotFoundError extends YTAPIError {}

/**
 * 429. `retryAfter` is the wait the server asked for, in seconds. `code` is
 * `rate_limited` for a burst over the key's rate (retried automatically) or
 * `daily_limit_exceeded` when a free account used its requests for the day
 * (thrown at once; it resets at 00:00 UTC).
 */
export class RateLimitedError extends YTAPIError {}

/** 5xx. Retried when `retryable` is not explicitly false. */
export class ServerError extends YTAPIError {}
