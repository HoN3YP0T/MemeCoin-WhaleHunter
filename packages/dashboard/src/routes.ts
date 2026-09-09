import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Repositories } from "@whale-sniper/db";
import type { MetricsStore } from "@whale-sniper/monitoring";
import {
  buildCandidatesList,
  buildOpenPositions,
  buildOverview,
  buildSignalsList,
  buildTradesList,
  buildWhaleDetail,
  buildWhalesList,
} from "./aggregate.js";
import type { RecentEventLog } from "./eventLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

export interface DashboardContext {
  repos: Repositories;
  metrics: MetricsStore;
  eventLog: RecentEventLog;
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function serveStatic(res: ServerResponse, filePath: string): Promise<boolean> {
  const ext = path.extname(filePath);
  const contentType = STATIC_CONTENT_TYPES[ext];
  if (!contentType) return false;
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function parsePositiveIntParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read-only dashboard routes, mounted into the existing health server
 * (same port, same raw-http request handler) rather than opening a second
 * port. Returns true if it handled the request, false to let the caller
 * fall through (e.g. to /health, /metrics, or a 404).
 *
 * Every route here only reads repositories/metrics/the event log - no
 * mutation, matching the constraint that trade actions stay in Telegram's
 * /approve, /reject.
 */
export async function handleDashboardRequest(req: IncomingMessage, res: ServerResponse, ctx: DashboardContext): Promise<boolean> {
  if (!req.url) return false;
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  try {
    return await routeDashboardRequest(pathname, url, res, ctx);
  } catch (err) {
    // A repository lookup failing shouldn't take the whole health server
    // down - surface it as a 500 with a plain message, same spirit as
    // healthServer.ts's 404 fallback.
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

async function routeDashboardRequest(pathname: string, url: URL, res: ServerResponse, ctx: DashboardContext): Promise<boolean> {
  if (pathname === "/api/overview") {
    const overview = await buildOverview(ctx.repos, ctx.metrics.snapshot());
    sendJson(res, 200, overview);
    return true;
  }

  if (pathname === "/api/trades") {
    const limit = parsePositiveIntParam(url, "limit", 100);
    sendJson(res, 200, await buildTradesList(ctx.repos, limit));
    return true;
  }

  if (pathname === "/api/positions") {
    sendJson(res, 200, await buildOpenPositions(ctx.repos));
    return true;
  }

  if (pathname === "/api/whales") {
    sendJson(res, 200, await buildWhalesList(ctx.repos));
    return true;
  }

  const whaleDetailMatch = pathname.match(/^\/api\/whales\/([^/]+)$/);
  if (whaleDetailMatch) {
    const address = decodeURIComponent(whaleDetailMatch[1]);
    sendJson(res, 200, await buildWhaleDetail(ctx.repos, address));
    return true;
  }

  if (pathname === "/api/candidates") {
    sendJson(res, 200, await buildCandidatesList(ctx.repos));
    return true;
  }

  if (pathname === "/api/signals") {
    const limit = parsePositiveIntParam(url, "limit", 100);
    sendJson(res, 200, buildSignalsList(ctx.eventLog.recent(limit), limit));
    return true;
  }

  if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
    return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
  }

  if (pathname.startsWith("/dashboard/")) {
    const relative = pathname.slice("/dashboard/".length);
    return serveStatic(res, path.join(PUBLIC_DIR, relative));
  }

  return false;
}
