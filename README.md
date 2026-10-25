# dogeuni-mcp

MCP server and Chrome native-messaging host for the agent feature of the
DogeUni Dogecoin wallet extension.

```
Claude Code ─stdio─► dogeuni-mcp serve ─unix socket (~/.dogeuni/agent.sock, 0600)─► dogeuni-mcp host ◄─connectNative─ DogeUni extension
```

- **`serve`**: an MCP server on stdio. Tools: `wallet_status`, `get_agent_account`, `get_agent_balance`.
- **`host`**: the native messaging host `com.dogeuni.agent`. Chrome starts it when you start an agent
  session in the wallet. It listens on the socket and forwards requests to the extension.
  It only forwards; all authentication happens in the extension.

This release (P2b) is **read-only**: it can see the agent account's address and balance and the
session status. It cannot spend. Spending, with per-transaction and 24h limits enforced by
the wallet, comes in P2c.

The wire protocol is in [docs/protocol.md](docs/protocol.md) (copied from the wallet repo's plan, §2.1).

Requirements: Node.js 18 or later; macOS or Linux; Google Chrome.

## Setup

1. **Install the package globally**, so the path that Chrome launches stays put:

   ```sh
   npm install -g dogeuni-mcp
   ```

   (`npx dogeuni-mcp …` also works for every command, but `install` records the absolute path of the
   package it runs from. An npx cache path can be cleaned up later, which breaks the host.)

2. **Register the host with Chrome:**

   ```sh
   dogeuni-mcp install                         # store version of the extension
   dogeuni-mcp install --extension-id <id>     # unpacked / dev build
   dogeuni-mcp install --hosts-dir <dir>       # another Chromium-based browser or profile dir
   ```

   This writes two files:
   - `<hosts-dir>/com.dogeuni.agent.json`: the host manifest. `allowed_origins` lists only the given
     extension. The default hosts dir is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`
     on macOS and `~/.config/google-chrome/NativeMessagingHosts` on Linux.
   - `~/.dogeuni/host`: a 0755 sh launcher that runs `exec "<node>" "<…/bin/host.js>"` with absolute
     paths, because Chrome does not pass your shell's `PATH`. If you switch Node versions (nvm, volta…),
     run `install` again.

   `dogeuni-mcp uninstall [--hosts-dir <dir>]` removes both files and leaves `credentials.json`.

3. **Start an agent session** in the DogeUni wallet (Agent page → start session). Chrome launches the
   host; it exits when the session ends.

4. **Pair:**

   ```sh
   dogeuni-mcp pair --name "Claude Code"
   ```

   The terminal prints a 6-digit code. The wallet opens a confirmation window with the agent name and
   the same code. Check that the codes match, then enter your wallet password. On success the token is
   saved to `~/.dogeuni/credentials.json` (mode 0600). The wallet waits up to 5 minutes. Only one
   pairing can wait at a time.

5. **Add the server to Claude Code:**

   ```sh
   claude mcp add dogeuni -- dogeuni-mcp serve
   # or, without a global install:
   claude mcp add dogeuni -- npx -y dogeuni-mcp serve
   # add `--scope user` to make it available in every project
   ```

   Or in JSON (`.mcp.json` / any client that uses `mcpServers`):

   ```json
   {
     "mcpServers": {
       "dogeuni": { "command": "dogeuni-mcp", "args": ["serve"] }
     }
   }
   ```

If no session is running, tools answer "Start an agent session in the DogeUni wallet first."
Without credentials they answer "Pair first: run `npx dogeuni-mcp pair`."

`DOGEUNI_HOME` overrides `~/.dogeuni` (socket, credentials, launcher).

## Security notes

- **The token is a local secret.** It is 32 random bytes in `~/.dogeuni/credentials.json` (0600, in a
  0700 directory). Anyone who has it can call the wallet as this agent.
- **The socket is not the security boundary.** Any process running as your user can connect to it.
  Every request carries the token, and the extension checks it. The extension stores only
  `SHA-256(token)`, never the token. Revoking the agent in the wallet takes effect on the next call.
- The host manifest allows only the DogeUni extension ID to start the host. The host does no
  authentication itself.
- Strings in tool output that the user controls (such as the agent name) are wrapped in
  `untrusted_data`, so a model can treat them as data, not instructions. Unknown fields in wallet replies
  are dropped.
- P2b is read-only. The agent uses its own account, separate from your main accounts. Spending
  (P2c) will be limited by grants enforced in the wallet.

## Development

```sh
npm install
npm test        # node --test; everything runs against temp dirs
```

Tests never touch the real `~/.dogeuni` or Chrome's NativeMessagingHosts directory. They always set
`DOGEUNI_HOME` and `--hosts-dir` to temp dirs. When you run `install` by hand while developing, do the
same.
