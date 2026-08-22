import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { supportRouter } from './support.routes.js';
import { accountRouter } from './account.routes.js';
import { bootstrapRouter } from './bootstrap.routes.js';
import { transactionsRouter } from './transactions.routes.js';
import { deletedRouter } from './deleted.routes.js';
import { settlementRouter } from './settlement.routes.js';
import { approvalsRouter } from './approvals.routes.js';
import { reportsRouter } from './reports.routes.js';
import { exportRouter } from './export.routes.js';
import { backupRouter } from './backup.routes.js';
import { eventsRouter } from './events.routes.js';
import { blockIfFrozen, requireAuth } from '../middleware/auth.js';
import { notFound } from '../middleware/errorHandler.js';
import { config } from '../env.js';

export const apiRouter = Router();

// Nothing under /api may ever be cached.
//
// This matters the moment the app is served through a CDN (Cloudflare Tunnel, in this
// project). Cloudflare caches by extension and heuristics, and a cached /api/bootstrap would
// show a partner yesterday's balances with no way to tell it was stale - the worst possible
// failure for a ledger. The static frontend is still cached normally; only the API opts out.
apiRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'ledger-plus' });
});

// Deliberately public and above requireAuth: a client needs to be able to discover that it is
// out of date while signed out, locked, or frozen - those are exactly the states someone might
// be stuck in BECAUSE they are running an old build.
apiRouter.get('/version', (_req, res) => {
  res.json({
    buildId: config.build.buildId,
    buildTime: config.build.buildTime,
    branch: config.build.branch,
    minClientBuildTime: config.minClientBuildTime,
  });
});

// Register and login are the only routes reachable without a session.
apiRouter.use('/auth', authRouter);

// Cross-tenant and password-gated. Mounted BEFORE requireAuth() because it verifies its own
// separate support token instead - and 404s entirely unless LEDGER_SUPPORT_PASSWORD is set.
apiRouter.use('/support', supportRouter);

// Everything below this line requires a valid Ledger+ token AND membership of a partnership.
// Mounting the gate once, here, is what makes it impossible to add a route that forgets it.
apiRouter.use(requireAuth());

// Reachable even while the partnership is frozen. /events is how a frozen client hears that
// it has been released; /account is how the device unlocks and signs out. Everything below
// blockIfFrozen() is refused with a 423 until support lifts it.
apiRouter.use('/events', eventsRouter);
apiRouter.use('/account', accountRouter);
apiRouter.use(blockIfFrozen());

// One-request refresh used by the app itself; the granular routes below still work.
apiRouter.use('/bootstrap', bootstrapRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/deleted', deletedRouter);
apiRouter.use('/settlement', settlementRouter);
apiRouter.use('/approvals', approvalsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/export', exportRouter);
apiRouter.use('/backup', backupRouter);

apiRouter.use(notFound);
