// @mimi/server — Phase 1 placeholder

export interface ServeOptions {
  port: number;
  cwd: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settingsManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionManager: any;
}

export async function startServer(_options: ServeOptions): Promise<void> {
  throw new Error("Not implemented — Phase 2");
}
