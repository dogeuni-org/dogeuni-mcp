# dogeuni-mcp

MCP server and Chrome native-messaging host for the agent feature of the
DogeUni Dogecoin wallet extension.

```
Claude Code ─stdio─► dogeuni-mcp serve ─unix socket (~/.dogeuni/agent.sock, 0600)─► dogeuni-mcp host ◄─connectNative─ DogeUni extension
```

- **`serve`**: an MCP server on stdio. Read-only tools: `wallet_status`, `get_agent_account`,
  `get_agent_balance`, `quote_fee`. Spending tools: `prepare_send`, `submit_send`.
- **`host`**: the native messaging host `com.dogeuni.agent`. Chrome starts it when you start an agent
  session in the wallet. It listens on the socket and forwards requests to the extension.
  It only forwards; all authentication happens in the extension.

The agent spends only from the wallet's dedicated agent account, never from your main accounts.
Recipients and limits (per transaction, rolling 24h) are set by you in the wallet's grant, and the
wallet enforces them:

| Tool | What it does |
|---|---|
| `quote_fee {to, amount}` | Fee for a send. Does not spend. |
| `prepare_send {to, amount}` | Builds the send without signing it. Returns a `prepareId` (valid 5 minutes, usable once) and a policy preview: `ALLOW` = sends without asking, `ESCALATE` = you will be asked to approve, `DENY` = will be refused. |
| `submit_send {prepareId}` | Signs and broadcasts. Within the grant it goes out at once; otherwise the wallet opens an approval window and the call waits up to 5 minutes for your answer. |

Amounts are DOGE decimal strings with at most 8 decimals. If `submit_send` reports `BROADCAST_FAILED`,
the transaction was signed and may still have gone out; the agent is told not to retry without
checking the chain.

Because `submit_send` can wait for your approval, the server waits up to 6 minutes for it (other calls:
30 seconds). If your MCP client has a shorter tool timeout, raise it (Claude Code: `MCP_TOOL_TIMEOUT`, in
milliseconds). The server sends progress notifications while it waits when the client asks for them.

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
- The agent uses its own account, separate from your main accounts, and cannot pick another one: the
  wallet accepts only the documented params. Every limit is enforced in the wallet, not in this server.

## Development

```sh
npm install
npm test        # node --test; everything runs against temp dirs
```

Tests never touch the real `~/.dogeuni` or Chrome's NativeMessagingHosts directory. They always set
`DOGEUNI_HOME` and `--hosts-dir` to temp dirs. When you run `install` by hand while developing, do the
same.
