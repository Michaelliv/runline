#!/usr/bin/env node
console.error(
  "[runline] runline is now codemode. This command stops working in 0.48.0: install @shiftlabs/codemode and run `codemode`.",
);
await import("@shiftlabs/codemode/main");
