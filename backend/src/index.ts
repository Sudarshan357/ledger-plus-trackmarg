// env.ts must be imported before anything that reads process.env - notably the Prisma client,
// which picks up DATABASE_URL when it is constructed.
import { config } from './env.js';
import { buildApp } from './app.js';

import fs from 'node:fs';

const app = buildApp();

app.listen(config.port, config.host, () => {
  console.log(`Ledger+ API listening on http://${config.host}:${config.port}`);
  // Says plainly whether this process is also serving the built frontend. In dev it is not
  // (Vite owns that), and the difference is otherwise only visible as a confusing 404.
  console.log(
    fs.existsSync(config.distDir)
      ? `Serving frontend from ${config.distDir}`
      : `No build at ${config.distDir} - API only (run "npm run build" to serve the app too)`,
  );
});
