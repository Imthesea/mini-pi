#!/usr/bin/env node
import("../dist/cli.js").then((m) =>
  m.main(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
    exit: (code: number) => process.exit(code),
  }),
).catch((err) => {
  console.error(err);
  process.exit(1);
});
