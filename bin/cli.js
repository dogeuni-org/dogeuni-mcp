#!/usr/bin/env node
import { dogeuniHome } from '../src/paths.js';
import { VERSION } from '../src/version.js';

const USAGE = `dogeuni-mcp ${VERSION}: MCP server for the DogeUni wallet agent (read-only)

Usage:
  dogeuni-mcp [serve]                    Run the MCP server on stdio (default)
  dogeuni-mcp pair [--name <name>]       Pair with the wallet (name: 1–40 characters)
  dogeuni-mcp install [--extension-id <id>] [--hosts-dir <dir>]
                                         Register the native messaging host with Chrome
  dogeuni-mcp uninstall [--hosts-dir <dir>]
  dogeuni-mcp host                       Native messaging host (Chrome starts this)

Environment:
  DOGEUNI_HOME   state directory (default ~/.dogeuni)
`;

/**
 * Parse `--flag value` / `--flag=value` options.
 * @param {string[]} args
 * @param {string[]} allowed
 */
function parseOptions(args, allowed) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      opts.help = 'true';
      continue;
    }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m || !allowed.includes(m[1])) throw new UsageError(`Unknown argument: ${a}`);
    let value = m[2];
    if (value === undefined) {
      value = args[++i];
      if (value === undefined) throw new UsageError(`--${m[1]} needs a value`);
    }
    opts[m[1]] = value;
  }
  return opts;
}

class UsageError extends Error {}

async function main(argv) {
  const [cmd = 'serve', ...rest] = argv;
  switch (cmd) {
    case 'serve': {
      parseOptions(rest, []);
      const { runServe } = await import('../src/server.js');
      await runServe();
      return null; // keep running
    }
    case 'host': {
      // Chrome passes the caller origin (and on some platforms more); ignore all args.
      const { runHost } = await import('../src/host.js');
      await runHost();
      return null;
    }
    case 'pair': {
      const opts = parseOptions(rest, ['name']);
      if (opts.help) return help();
      const { runPair } = await import('../src/pair.js');
      return runPair({ ...(opts.name !== undefined ? { name: opts.name } : {}) });
    }
    case 'install': {
      const opts = parseOptions(rest, ['extension-id', 'hosts-dir']);
      if (opts.help) return help();
      const { install } = await import('../src/install.js');
      const r = install({ home: dogeuniHome(), extensionId: opts['extension-id'], hostsDir: opts['hosts-dir'] });
      process.stdout.write(`Wrote ${r.manifest}\nWrote ${r.launcher}\n`);
      return 0;
    }
    case 'uninstall': {
      const opts = parseOptions(rest, ['hosts-dir']);
      if (opts.help) return help();
      const { uninstall } = await import('../src/install.js');
      const removed = uninstall({ home: dogeuniHome(), hostsDir: opts['hosts-dir'] });
      process.stdout.write(removed.length ? removed.map((p) => `Removed ${p}\n`).join('') : 'Nothing to remove.\n');
      return 0;
    }
    case '-h':
    case '--help':
    case 'help':
      return help();
    case '-v':
    case '--version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    default:
      throw new UsageError(`Unknown command: ${cmd}`);
  }
}

function help() {
  process.stdout.write(USAGE);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`dogeuni-mcp: ${err.message}\n`);
      process.exitCode = 1;
    }
  },
);
