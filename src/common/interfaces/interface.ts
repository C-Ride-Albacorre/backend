import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    email: string;
  };
}

export interface ParsedQuery {
  page: number;
  limit: number | null;
  startDate: Date | null;
  endDate: Date | null;
  search: string | undefined;
  sort: string | undefined;
}

export interface OAuthState {
  role: string;
  timestamp: number;
  nonce: string;
}
