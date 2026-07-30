/**
 * agentbox — hand-rolled argument parser (no external deps).
 *
 * Supports both `--flag value` and `--flag=value` forms. Boolean flags
 * (`--help`, `--no-cache`) take no value. The first positional is the command
 * (defaulting to `up` when only flags are present). `-h` is an alias for
 * `--help`. A bare `--` ends flag parsing; everything after is positional.
 */

/** Long-form flags that consume a following value. */
const VALUE_FLAGS = new Set(["workspace", "memory", "cpus", "port", "network", "gpus"]);

export interface ParsedArgs {
  /** First positional, or "up" when none is supplied. */
  command: string;
  /** Normalized flags (long names → string value or boolean true). */
  flags: Record<string, string | boolean>;
  /** All positionals in order (command is positionals[0]). */
  positionals: string[];
  /** True when --help / -h was passed anywhere. */
  helpRequested: boolean;
  /** True when the command was given explicitly (vs. defaulted to "up"). */
  hasExplicitCommand: boolean;
  /**
   * Value flags (e.g. --port) given with no following value, in order
   * encountered. The router treats this as a hard error rather than
   * silently falling back to a default (a bare `--gpus` should not
   * silently run without a GPU).
   */
  missingValueFlags: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const missingValueFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (tok === "--") {
      // Everything after a bare `--` is positional.
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        const name = body.slice(0, eq);
        flags[name] = body.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[i + 1];
        // Consume the next token as the value unless it looks like a flag.
        if (next !== undefined && !next.startsWith("-")) {
          flags[body] = next;
          i++;
        } else {
          // Missing value — record presence for backward-compat, but flag it
          // as an error too: silently falling back to a default (e.g. --gpus
          // with no value quietly running without a GPU) is worse than
          // failing fast.
          flags[body] = true;
          missingValueFlags.push(body);
        }
      } else {
        flags[body] = true;
      }
      continue;
    }

    if (tok === "-h") {
      flags.help = true;
      continue;
    }

    if (tok.startsWith("-") && tok.length > 1) {
      // Unknown short flag — record it so the router can complain.
      flags[tok.slice(1)] = true;
      continue;
    }

    positionals.push(tok);
  }

  const hasExplicitCommand = positionals.length > 0;
  const command = hasExplicitCommand ? positionals[0] : "up";
  const helpRequested = flags.help === true || flags.h === true;

  return {
    command,
    flags,
    positionals,
    helpRequested,
    hasExplicitCommand,
    missingValueFlags,
  };
}
