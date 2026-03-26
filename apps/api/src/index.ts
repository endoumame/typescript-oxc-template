import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (ctx) => ctx.json({ status: "ok" }));

export type AppType = typeof app;
export default app;
