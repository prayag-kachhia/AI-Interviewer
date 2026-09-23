import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

const app = createApp(webOrigin);

console.log(`API listening on http://localhost:${port}`);

export default { port, fetch: app.fetch };
