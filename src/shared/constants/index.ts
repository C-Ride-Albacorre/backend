export const configContants = {
  port: 'PORT',
  jwtSecret: 'JWT_SECRET',
  jwtDuration: 'JWT_DURATION',
  refreshTokenSecret: 'REFRESH_TOKEN_SECRET',
  refreshTokenDuration: 'REFRESH_TOKEN_DURATION',
  tokenDuration: 'TOKEN_EXPIRATION_DURATION',
  frontendForgotPasswordUrl: 'FRONTEND_FORGOT_PASSWORD_URL',
  
};


export type UserRole = 'CUSTOMER' | 'ADMIN' | 'VENDOR' | 'DISPATCHER' | 'SUPER_ADMIN';

export const UserRole = {
  CUSTOMER: 'CUSTOMER' as UserRole,
  ADMIN: 'ADMIN' as UserRole,
  VENDOR: 'VENDOR' as UserRole,
  DISPATCHER: 'DISPATCHER' as UserRole,
  SUPER_ADMIN: 'SUPER_ADMIN' as UserRole,
};

/**
 * Tunable business rules for driver performance metrics.
 * Change here — never inline — so ops and product can adjust without
 * hunting through query logic.
 */
const PERFORMANCE_RULES = {
  /** Grace period after the ETA before a delivery counts as late. */
  ON_TIME_BUFFER_MS: 5 * 60 * 1000,          // +5 minutes

  /**
   * Whether expired offers (driver never responded in time) should count
   * against the acceptance rate.
   *   false → exclude from denominator (default; expired ≠ declined)
   *   true  → include in denominator (expired counts as a miss)
   */
  COUNT_EXPIRED_AS_MISS: false,

  /** Minimum sample size before showing a rate. Below this → null. */
  MIN_SAMPLE_FOR_RATE: 1,
} as const;