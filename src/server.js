import { createApp } from './app.js';
const app = await createApp();
const port = Number(process.env.PORT || 8766), host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Navigation ready: http://${host}:${port}`));
const shutdown = () => server.close(() => { app.locals.database.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
