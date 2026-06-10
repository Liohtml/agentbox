/**
 * agentbox entry point (lead-owned, thin). Delegates to the cli module.
 */
import { run } from "./cli/index.ts";

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("agentbox: fatal:", err?.message ?? err);
    process.exit(1);
  });
