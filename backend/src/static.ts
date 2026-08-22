import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { config } from './env.js';

/// Serves the built frontend in production. In dev the Vite server owns the frontend and
/// proxies /api here instead, so this mounts nothing when dist/ has not been built.
///
/// The cache policy here is what makes an update actually reach a device. Vite gives every
/// JS and CSS file a content hash, so those can be cached hard and forever - a new build
/// produces new filenames. index.html is the opposite: its name never changes and its whole
/// job is to name the current hashed files, so it must be revalidated every time. Cache it
/// and a browser keeps loading last week's bundle no matter how many times you deploy.
export function mountStatic(app: Express): void {
  if (!fs.existsSync(config.distDir)) return;

  const indexFile = path.join(config.distDir, 'index.html');
  const sendIndex = (res: express.Response) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(indexFile);
  };

  app.use(
    express.static(config.distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.set('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Content-hashed by Vite, so this exact file can never change under this name.
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          // public/ files (theme-init.js) keep their names across builds, so they get a short
          // life rather than an immutable one.
          res.set('Cache-Control', 'public, max-age=300');
        }
      },
    }),
  );

  // SPA fallback: any non-/api path that is not a real file resolves to index.html so deep
  // links like /settings/deleted work on a hard refresh. /api is excluded so an unknown API
  // route still returns the JSON 404 rather than a page of HTML.
  app.get(/^(?!\/api\/).*/, (_req, res) => sendIndex(res));
}
