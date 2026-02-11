
export enum UserRole {
  CUSTOMER= 'CUSTOMER',
  VENDOR= 'VENDOR',
  DISPATCHER= 'DISPATCHER',
  ADMIN= 'ADMIN',
  SUPER_ADMIN= 'SUPER_ADMIN'
}

export enum VerificationPurpose {
  REGISTRATION = 'registration',
  LOGIN = 'login',
  PASSWORD_RESET = 'password_reset',
  TWO_FACTOR = 'two_factor',
  VENDOR_EMAIL_VERIFICATION = 'vendor_email_verification',
  VENDOR_PHONE_VERIFICATION = 'vendor_phone_verification',
}

export enum DocumentType {
  CAC = 'CAC',
  BUSINESS_PERMIT = 'BUSINESS_PERMIT',
  ID_PROOF = 'ID_PROOF',
}

export enum VendorStatus {
  PENDING_EMAIL_VERIFICATION = 'PENDING_EMAIL_VERIFICATION',
  PENDING_PHONE_VERIFICATION = 'PENDING_PHONE_VERIFICATION',
  PENDING_ONBOARDING = 'PENDING_ONBOARDING',
  PENDING_DOCUMENTS = 'PENDING_DOCUMENTS',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export enum DashboardFilterTypes {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_WEEK = 'last_week',
  THIS_WEEK = 'this_week',
  LAST_MONTH = 'last_month',
  THIS_MONTH = 'this_month',
  THIS_YEAR = 'this_year',
  CUSTOM = 'custom',
}

