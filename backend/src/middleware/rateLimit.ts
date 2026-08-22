import rateLimit from 'express-rate-limit';

// A 4-digit PIN is only 10,000 combinations, so throttling the endpoints that check one is
// not optional - it is the main thing standing between an attacker and a partnership's books.
// Counting only FAILED attempts means a partner typing their own PIN correctly all day never
// locks themselves out.

// The acceptance suite registers and logs in several times per run, which would trip these
// buckets and make the tests fail for a reason that has nothing to do with the code under
// test. Disabled only when NODE_ENV is exactly 'test'.
const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
};

export const registerLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 8,
  message: { message: 'Too many sign-up attempts. Please try again later.' },
});

export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please wait a minute and try again.' },
});

export const unlockLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please wait a minute and try again.' },
});

export const changePinLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please try again later.' },
});

// The support password is a single credential guarding every client's books, so it gets the
// tightest bucket in the app. Failed attempts only, counted per IP.
export const supportLoginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' },
});
