import { Router } from 'express';
import { subscribe, unsubscribe } from '../services/sse.js';
import { auth } from '../middleware/auth.js';

export const eventsRouter = Router();

/// Server-sent events, scoped to the caller's group code. This is what makes one partner's
/// entry appear on the other partner's phone without a refresh.
eventsRouter.get('/', (req, res) => {
  const { groupCode } = auth(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx and similar proxies buffer responses by default, which holds events back until
    // the buffer fills - fatal for a stream that sends a few bytes at a time.
    'X-Accel-Buffering': 'no',
  });
  // The `connected` handshake is load-bearing on the client, not decoration: it is how the
  // app confirms the stream is actually flowing. Some proxies - Cloudflare quick tunnels
  // among them - accept the connection and then buffer the body indefinitely, so a client
  // that assumed "connected socket == working stream" would sit there believing it had live
  // sync while receiving nothing. See the fallback in src/state/AppContext.tsx.
  res.write('retry: 5000\n\n');
  res.write('event: connected\ndata: {}\n\n');

  subscribe(groupCode, res);

  // Mobile networks and proxies drop idle connections. A comment line every 25s keeps the
  // socket alive without the client having to treat it as an event.
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe(groupCode, res);
  });
});
