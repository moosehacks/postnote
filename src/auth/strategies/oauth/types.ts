/**
 * Shared types for OAuth/SSO per-IdP handlers.
 */

import type { Page } from 'playwright';
import type { AuthConfig } from '../../detect.js';

/** Input available to every OAuth handler. */
export interface OAuthHandlerInput {
  /** The page currently on the IdP login screen. */
  page: Page;
  /** Username / email to use. Read from env by the caller. */
  username: string;
  /** Password to use. Read from env by the caller. */
  password: string;
  /** After submit, wait up to this many ms for the success check. */
  timeoutMs: number;
  /** The original application URL (pre-redirect) — used for post-auth check. */
  appUrl: string;
  /** Auth check that signals successful login on the app origin. */
  successCheck: AuthConfig;
}

/** Return type of every OAuth handler. */
export interface OAuthHandlerResult {
  ok: boolean;
  error?: string;
}
