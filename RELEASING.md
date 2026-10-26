# 发布清单（npm + GitHub Release）

> 不在 npm 包里（`files` 只带 `bin/ src/ docs/ README.md`）。发布由 `.github/workflows/publish.yml` 在推送 `v*` tag 时执行：两个系统上跑测试 → 等 `npm` environment 的审批人批准 → `npm pack` 一次 → 带 provenance 发布**这个 tarball** → 核对 npm 上的 integrity 与本地一致 → 把同一个 tarball 和 `SHA256SUMS` 挂到 GitHub Release。
> 状态（2026-10-25）：**未发布**。下面「阻断项」未清零前不要推 tag。

## 阻断项

| # | 项 | 现状 | 谁来做 |
|---|---|---|---|
| 1 | **仓库可见性**：npm provenance 只给公开仓库签发；私有仓库带 `--provenance` 发布会直接失败（workflow 故意这样，避免无 attestation 发出去） | **决定公开**（2026-10-26），仍是 PRIVATE。公开前扫描（2026-10-26，全部 13 个 commit + 工作区，gitleaks 8.30.1 + 私钥 / WIF / 助记词 / token / 本机路径 / 内网 IP 的补充 grep）：无密钥；gitleaks 的 3 条 `generic-api-key` 都是 0660ebb 的测试向量（字节 0x00..0x1f 的 base64url）。提交者邮箱原是 `<用户名>@<主机名>.local`（本机没设 `user.email`，git 用了 用户名@主机名）；2026-10-26 改写全部历史为 GitHub noreply `7566395+chinasong@users.noreply.github.com`（文件树不变，SHA 全变），本仓库已设 `user.email` | 维护者：切 Visibility，然后在仓库设置里打开 secret scanning + push protection、private vulnerability reporting，给 `main` 加禁止 force push / 删除的 ruleset，给 `v*` tag 加只允许维护者创建的 ruleset |
| 2 | **钱包先上架**：MCP 只有在钱包实现了 agent 协议（P2a–P2c）时才有用 | 1.4.20（含 P2，无设置页入口）已建 GitHub Release（2026-10-26），待 CWS 上线 | 先发一个带 P2 的钱包版本（设置页仍不挂入口），等 CWS 上线 |
| 3 | **最低钱包版本**：README 写明「需要 DogeUni Wallet ≥ x.y.z」 | ✅ README 写「DogeUni Wallet 1.4.21 or later」，入口写成「Settings → Agent account」（2026-10-26）。1.4.20 已实现协议但没有设置页入口；npm 先发、1.4.21 后上架的顺序见钱包 `docs/ai-wallet-p2-plan.md` §6 | — |
| 4 | **钱包文案与 README 矛盾**：README 要求 `npm install -g`（`npx` 的缓存路径可能被清理，host 会断），钱包 Agent 页和 P2 计划仍写 `npx dogeuni-mcp install` / `npx dogeuni-mcp pair` | ✅ 钱包 main 已改为 `npm install -g dogeuni-mcp` + `dogeuni-mcp install` / `dogeuni-mcp pair`（2026-10-25） | 随下一个钱包版本发出 |

## 一次性设置

1. **npm 账号**：开启 2FA。包名 `dogeuni-mcp`（无 scope）2026-10-25 查询时未被占用（`npm view` 返回 404）。
2. **GitHub environment `npm`**：Settings → Environments → New → `npm`；Required reviewers 填自己；Deployment branches and tags 只允许 `v*` tag。
3. **首发凭据**：npm 文档没说给尚不存在的包配置 trusted publisher 是否可行（配置入口在包的设置页）。所以首发用 granular access token（只授权发布这个包、有效期 1 天），存为仓库 secret `NPM_TOKEN`。
4. **首发后切到 trusted publishing**（npm 包设置 → Trusted Publisher → GitHub Actions）：组织 `dogeuni-org`，仓库 `dogeuni-mcp`，workflow `publish.yml`，environment `npm`。新配置要在 2 天内完成第一次成功发布，否则失效。切换后：
   - 包设置 → Publishing access 选「Require two-factor authentication and disallow tokens」；
   - 在 npm 撤销那个 token，并删除仓库 secret `NPM_TOKEN`。
   - Trusted publishing 要求 npm ≥ 11.5.1、Node ≥ 22.14（workflow 用 Node 22 + `npm@11.21.1`）。

## 每次发布

1. `main` 干净；`npm test` 全绿（当前 46/46），且 `main` 的 Test workflow（Linux + macOS）是绿的。
2. 改 `package.json` 的 `version`（`src/version.js` 从它读取）；`docs/protocol.md` 与钱包 `ai-wallet-p2-plan.md` §2.1 一致。
3. **钱包 e2e 对真实 host**（本机手动，CI 里没有 Chrome）：在旁边的 `dogeuni-wallet` checkout（`main`，已 `yarn build:chrome`）里，对这份 checkout 跑 agent 的两组 e2e，Playwright Chromium 和本机 Google Chrome 各一遍：
   ```sh
   cd ../dogeuni-wallet
   E2E_REAL_HOST=../dogeuni-mcp node tests/e2e/agent-gateway.e2e.js
   E2E_REAL_HOST=../dogeuni-mcp node tests/e2e/agent-spend.e2e.js
   E2E_BROWSER=chrome E2E_REAL_HOST=../dogeuni-mcp node tests/e2e/agent-gateway.e2e.js
   E2E_BROWSER=chrome E2E_REAL_HOST=../dogeuni-mcp node tests/e2e/agent-spend.e2e.js
   ```
   - 全部通过：0.1.0 时 agent-gateway 43/43（需要替身注入畸形消息的 3 项自动跳过）、agent-spend 66/66。
   - 每次开头打印 `real host: … <version>, installed by dogeuni-mcp install (launcher …)`，版本应是第 2 步改后的版本；`hello` 的版本检查也用它。
   - host 由 `dogeuni-mcp install --extension-id <测试扩展> --hosts-dir <临时 profile>` 安装，Chrome 原样启动生成的 manifest 和 launcher；`DOGEUNI_HOME` 是临时目录。不碰 `~/.dogeuni`，也不碰真实 Chrome 的 NativeMessagingHosts 目录。广播全部被拦截，没有真实资金。
   - 只测了 `--hosts-dir` 指定目录的情况；不带 `--hosts-dir` 写进默认目录的那条路，留给发布后的冒烟测试（钱包 `ai-wallet-p2-plan.md` §6 第 7 步）。
4. `npm pack --dry-run`：只应有 `bin/ src/ docs/ README.md LICENSE package.json`（0.1.0 时 18 个文件、24.3 kB，2026-10-26 加 hello 之后）。
5. 提交，打 tag：`git tag v<version>` → `git push origin main v<version>`。
6. 在 Actions 里批准 `npm` environment；workflow 会：发布 → 核对 `dist.integrity` → 建 Release（tarball + `SHA256SUMS`）。
7. 发布后在 npm 页面确认有 Provenance 标记，并按下面「用户如何校验」走一遍。

## 用户如何校验

```sh
npm view dogeuni-mcp@<version> dist.integrity      # 与 Release 里 tarball 的 sha512 一致
shasum -a 256 -c SHA256SUMS                         # 下载 Release 的 tarball 和 SHA256SUMS 后
npm audit signatures                                # 在装了 dogeuni-mcp 的项目里：校验 registry 签名和 provenance
```

## 不在本清单范围

- 设置页挂 Agent 入口：npm 发布之后的钱包版本做。
