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

