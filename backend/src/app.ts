import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { mountStatic } from './static.js';

/// Exported without .listen() so tests can mount it with supertest and no real port is
/// opened. index.ts is the only place that listens.
export function buildApp(): Express {
  const app = express();

  // Behind Render/any reverse proxy, without this every request looks like it came from the
  // proxy's IP - which would make the PIN rate limiters throttle all users as one bucket.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The app may be served from a different origin than its API (phone browser pointed at
      // a LAN address or tunnel), so connect-src cannot be locked to 'self'.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ['*'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      // Lets the PDF/CSV blob downloads open in a new tab on mobile Safari.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // Wildcard origin is deliberate and safe here: auth is a manually-attached Bearer token,
  // never a cookie, so a permissive origin hands out no ambient credentials.
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);
  mountStatic(app);

  app.use(errorHandler());
  return app;
}
