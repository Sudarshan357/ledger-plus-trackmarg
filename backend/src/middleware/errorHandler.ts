import crypto from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';

/// Thrown by routes for any expected 4xx. Anything else reaching the handler below is a bug
/// and is reported as an opaque 500 with a correlation id.
export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

function isDbConnectionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  // Prisma's connection-level codes only. P2002 and friends mean the database answered
  // correctly and rejected the write, which is a 4xx situation, not an outage.
  return code === 'P1001' || code === 'P1002' || code === 'P1008' || code === 'P1017';
}

export function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }

    const correlationId = crypto.randomBytes(6).toString('hex');

    if (isDbConnectionError(err)) {
      console.error(`[${correlationId}] database connection error`, err);
      if (res.headersSent) { res.end(); return; }
      res.status(503).json({
        message: 'The database is temporarily unavailable - please try again in a few seconds.',
        code: 'DB_UNAVAILABLE',
        correlationId,
      });
      return;
    }

    // Detail stays server-side; the client gets an id it can quote so the incident can still
    // be traced back to this log line.
    console.error(`[${correlationId}]`, err);
    if (res.headersSent) { res.end(); return; }
    res.status(500).json({ message: 'Something went wrong on our end.', correlationId });
  };
}
