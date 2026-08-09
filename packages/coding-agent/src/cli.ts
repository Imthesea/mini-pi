#!/usr/bin/env node
/**
 * CLI entry point for the coding agent.
 * 从 pi 项目 cli.ts 抄来。
 */
import { APP_NAME } from "./config.js";
import { main } from "./main.js";

process.title = APP_NAME;
process.env.MIMI_CODING_AGENT = "true";

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
