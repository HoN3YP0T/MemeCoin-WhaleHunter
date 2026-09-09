import { createServer, type Server } from "node:http";
import type { MetricsStore } from "./MetricsStore.js";

export function startHealthServer(port: number, metrics: MetricsStore): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptimeSeconds: process.uptime() }));
      return;
    }
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(metrics.snapshot(), null, 2));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port);
  return server;
}
