import pino from "pino";

export interface Logger {
  fatal: (obj: Record<string, unknown> | string, msg?: string) => void;
  error: (obj: Record<string, unknown> | string, msg?: string) => void;
  warn: (obj: Record<string, unknown> | string, msg?: string) => void;
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
  debug: (obj: Record<string, unknown> | string, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export function createLogger(name: string, level = "info"): Logger {
  return pino({
    name,
    level,
    base: undefined,
  }) as unknown as Logger;
}

export const rootLogger = createLogger("whale-sniper", process.env.LOG_LEVEL ?? "info");
