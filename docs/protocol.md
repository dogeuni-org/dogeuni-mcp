# P2b protocol (extension ⇄ host ⇄ MCP)

> Copied verbatim from `dogeuni-wallet/docs/ai-wallet-p2-plan.md` §2.1 (2026-10-25). That section is the source of truth; change both repos together and bump `v`.
> The "Test vectors" and "Implementation notes" sections at the end are added here (dogeuni-mcp side) and are not part of the copied text.

### 2.1 P2b 协议（扩展 ⇄ host ⇄ MCP 的契约）

两个仓库各自实现、各自测试，以这一节为准；改协议要同时改两边，并把 `v` 加一。

**host**：名字 `com.dogeuni.agent`，由 `dogeuni-mcp` 包提供。

- 启动后在 `~/.dogeuni/agent.sock` 上监听，目录权限 0700，socket 权限 0600。
  - 已有 socket 而且还能连上，说明别的 host 在用，本进程直接退出。
  - 连不上就是残留文件，删掉重建。
- stdin 关闭（扩展断开）时删掉 socket 并退出。
- host 只做转发和最基本的格式检查，鉴权全部在扩展里做。

**MCP ⇄ host（socket）**：每行一个 JSON，单行最多 64 KiB。

- 请求：`{"id":<正整数>,"token":"<43 位 base64url>","method":"…","params":{…}}`，只有 `pair.request` 不带 token。
- 应答：`{"id":N,"result":…}` 或 `{"id":N,"error":{"code":"…","message":"…"}}`。
- 一行不是 JSON 对象、超长或 `id` 不合法时，host 回 `{"id":null,"error":{"code":"BAD_REQUEST"}}` 并断开该连接。

**host ⇄ 扩展（native messaging，标准的 4 字节长度 + JSON）**：

- host → 扩展：
  - `{"v":1,"type":"call","conn":C,"id":N,"token":…,"method":…,"params":…}`。`conn` 是 host 给每条 socket 连接分配的正整数。
  - `{"v":1,"type":"closed","conn":C}`：这条连接断了，扩展取消它挂着的配对请求。
- 扩展 → host：`{"v":1,"type":"result","conn":C,"id":N,"result":…}` 或 `{"v":1,"type":"error","conn":C,"id":N,"error":{"code","message"}}`。
- 扩展收到任何不合格式的消息都丢弃，不回复。

**错误码**：

| 错误码 | 什么时候返回 |
|---|---|
| `BAD_REQUEST` | 格式不对 |
| `UNAUTHORIZED` | 没带 token，或 token 未配对 / 已撤销 |
| `UNKNOWN_METHOD` | 没有这个方法 |
| `BUSY` | 已有一个配对在等确认 |
| `DENIED` | 用户拒绝、关掉了确认窗、agent 断开，或已配对满 5 个 |
| `TIMEOUT` | 5 分钟内没有确认 |
| `NO_SESSION` | 调用时 agent 会话已经结束（正常情况下会话一结束 host 就退出了） |
| `INTERNAL` | 其他错误，message 里不带细节 |

**方法（P2b 只有只读和配对）**：

| 方法 | params | result |
|---|---|---|
| `pair.request` | `{name: 1–40 字符, token}` | `{agentId}`，在用户确认后返回 |
| `wallet.status` | `{}` | `{session:{expiresAt}, agent:{agentId,name}}` |
| `account.get` | `{}` | `{address}`，只返回 agent 账户 |
| `account.balance` | `{}` | `{address, amount}`，`amount` 是 DOGE 的十进制字符串 |

**配对（D7）**：

1. MCP 本地生成 32 字节随机 token，计算配对码并显示在终端，然后发 `pair.request`。
   - 配对码 = `SHA-256("dogeuni-agent-pair:" + token)` 前 4 字节，按大端读成 uint32，对 10⁶ 取模，补零到 6 位。
2. 扩展用同样的算法算出配对码，弹出确认窗，显示 agent 名和配对码，要求输入密码。
   - 同一时间只允许一个配对，其余请求返回 `BUSY`。
3. 确认窗在钱包锁定时也能用，因为 agent 会话不随自动锁定结束（D2）。用户确认后，扩展只保存 `{agentId, name, tokenHash: SHA-256(token) 的 hex, createdAt}`，最多 5 个。
4. MCP 把 token 写入 `~/.dogeuni/credentials.json`，权限 0600。

撤销立即生效，下一次调用返回 `UNAUTHORIZED`。以下情况会清空全部已配对的 agent：agent 账户被删除，或钱包被重置。

**安装**：`npx dogeuni-mcp install [--extension-id <id>]`，默认 id 为商店版 `mfdcchljfhgjjpmlnplfdeianllkempb`。它会写两个文件：

- `NativeMessagingHosts/com.dogeuni.agent.json`：`allowed_origins` 只填这一个 id，`path` 指向下面的启动脚本。
- `~/.dogeuni/host`：0755 的 sh 脚本，内容是 `exec "<node 绝对路径>" "<host.js 绝对路径>"`。

**测试向量**：token `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8`（即字节 0x00–0x1f）对应的配对码是 `663428`，两个仓库的测试都要断言它。`expiresAt` 是毫秒时间戳。

**扩展侧连接**：

- agent 会话开始时，以及 SW 启动时如果 session 还在，扩展调用 `connectNative`；会话结束时断开，host 随之退出。
- 前提是已经拿到 `nativeMessaging` 权限（在页面里点「开始 agent 会话」时申请）。
- host 断开后不自动重连，状态显示为 `disconnected`，由用户点「重新连接」。
- 状态共有四种：`off`（没有会话）、`no-permission`、`connected`、`disconnected`。
  - `disconnected` 附带 Chrome 给出的原因（host 没装、被拒绝或已退出），扩展不去解析这段文字。

## 测试向量（dogeuni-mcp 侧追加，扩展侧应断言同样的值）

`token` 按 UTF-8 编码参与哈希；配对码 = `SHA-256("dogeuni-agent-pair:" + token)` 前 4 字节大端 uint32 mod 10⁶，补零到 6 位；`tokenHash` = `SHA-256(token)` 的小写 hex。

| token 原始 32 字节 | token（base64url，无填充，43 位） | 配对码 | tokenHash |
|---|---|---|---|
| `00 01 02 … 1f` | `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` | **`663428`** | `ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0` |
| 32 × `0c`（补零的情况） | `DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw` | **`025930`** | `b0bc9af7f323ccf883996da7e3a0c52377b51337ed048f807d873f6e9cf46b27` |
| 32 × `ff` | `__________________________________________8` | **`227796`** | `225f7e75329dd45aa354975d73987319309393af3a4c6733bc13601a4f1b8796` |

第一行的中间值：哈希前 4 字节 `41d7d384` → uint32 `1104663428` → mod 10⁶ = `663428`。断言见 `test/pairing.test.js`。

## 实现说明（§2.1 没写死、dogeuni-mcp 这样处理的地方）

- **转发字段**：host 把 socket 行里的 `id`、`token`、`method`、`params` 原样放进 `call`；行里没有的字段就不出现（`pair.request` 的 `call` 没有 `token` 键，而不是 `"token":null`）。host 不检查 `token` / `method` / `params` 的类型，留给扩展回 `BAD_REQUEST` / `UNAUTHORIZED`。
- **64 KiB**：指一行的字节数，不含结尾的 `\n`（行尾的 `\r` 也去掉）。没有换行、已经超过 64 KiB 的数据立刻判为 `BAD_REQUEST`。空行忽略。
- **BAD_REQUEST 应答**：严格按 §2.1 写成 `{"id":null,"error":{"code":"BAD_REQUEST"}}`（没有 `message`），写完关闭连接；同一个数据块里坏行之前的合法行已经转发，坏行之后的不再处理。
- **`closed`**：只对至少转发过一条 `call` 的连接发送（比如另一个 host 启动时的存活探测连接不会产生 `closed`）。
- **扩展 → host 的校验**：要求 `v === 1`、`conn` / `id` 为正安全整数；`result` 必须存在；`error.code` 为非空字符串，`error.message` 可省略、存在时必须是字符串。不合格或 `conn` 已断开的消息直接丢弃（只在 stderr 记一行，不含内容）。host 不跟踪哪些 `id` 在等应答，只按 `conn` 路由并带回 `id`。
- **帧大小**：Chrome → host 超过 1 MiB 的帧整帧跳过（不缓存）；host → Chrome 超过 1 MiB 的消息不会发出（socket 行最大 64 KiB，实际不会出现）。
- **残留 socket**：只删除确实是 socket 类型、且连接被拒绝（`ECONNREFUSED`）的文件；路径上是普通文件时 host 报错退出、不删除；探测 1 秒无响应按“有别的 host”处理。
- **退出**：stdin EOF / SIGINT / SIGTERM / SIGHUP 时删除 socket（只删 inode 与自己创建时一致的那个）并退出 0；另一个 host 在用时退出 1。
- **启动脚本**：`exec "<node>" "<host.js>"`，路径中的 `\ " $` 和反引号会转义；Chrome 额外传入的 origin 参数被忽略。
- **`expiresAt`**：按 JS 毫秒时间戳理解（MCP 输出里附带 `expiresAtIso`）。
- **名字 1–40 字符**：按 Unicode 码点计数，先去掉首尾空白，不允许控制字符；`pair` 默认名 `dogeuni-mcp`。
- **配对等待**：MCP 侧等 5 分 15 秒，让扩展的 `TIMEOUT` 先到。
