import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { MetricsStore } from "./MetricsStore.js";

/** Handles a request and returns true if it did, false to fall through to
 * the next handler (ultimately the 404 below). Deliberately untyped beyond
 * this shape - monitoring stays the base package and knows nothing about
 * who plugs in here (the dashboard package wires itself in via
 * `apps/sniper-runner`'s wiring.ts) so there's no dependency from
 * monitoring on any downstream package. */
export type ExtraRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;

export function startHealthServer(port: number, metrics: MetricsStore, extraHandler?: ExtraRequestHandler): Server {
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
    if (extraHandler) {
      void (async () => {
        const handled = await extraHandler(req, res);
        if (!handled) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        }
      })();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port);
  return server;
}
