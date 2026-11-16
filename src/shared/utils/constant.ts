
export const DEFAULT_LIMIT = 10;
export const DATE_TIME_OFFSET = 90000;
export type SortOrder = 'ASC' | 'DESC';
export const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];

export const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

export const SAMPLE_CUSTOMER_EMAIL = 'not-valid-sample-customer@customer.com';
export const GENERAL_OTP_MESSAGE = 'Your one-time password (OTP) for MyKiYa is';
export const CUSTOMER_OTP_NOTIFICATION_MESSAGE =
    'We received a request to verify your identity. Please use the following One-Time Password (OTP) to complete the verification process';
export const MERCHANT_EMAIL_VERIFICATION_OTP_MESSAGE =
    'We received a request to verify your alternate email address. Please use the following One-Time Password (OTP) to complete the verification process';
export const MERCHANT_PHONE_VERIFICATION_OTP_MESSAGE =
    'We received a request to verify your phone number. Please use the following One-Time Password (OTP) to complete the verification process';
export const URLS = {
    FAQ_URL: `${process.env.FRONTEND_BASEURL}/faqs`,
    MERCHANT_LOGIN_URL: `${process.env.FRONTEND_BASEURL}/merchant-login`,
};



// export const DISPATCH_CONSTANTS = {
//   RETRY_RADII_METERS: [10_000, 20_000],

//   DEFAULT_RADIUS_METERS: 10_000,

//   DRIVER_RESPONSE_TIMEOUT_SECONDS: 60,

//   PENDING_CLAIM_TTL_SECONDS: 90,

//   DISPATCH_RETRY_DELAY_MS: 30_000,

//   ASSIGNMENT_TIMEOUT_SECONDS: 180,
export const DISPATCH_CONFIG = {
  retry: {
    radiiMeters: [10_000, 20_000],
    defaultRadiusMeters: 10_000,
    delayMs: 30_000,
  },

  driver: {
    responseTimeoutSeconds: 60,
  },

  claim: {
    pendingTtlSeconds: 90,
  },

  assignment: {
    timeoutSeconds: 180,
  },
} as const;// } as const;