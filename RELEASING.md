# 发布清单（npm + GitHub Release）

> 不在 npm 包里（`files` 只带 `bin/ src/ docs/ README.md`）。发布由 `.github/workflows/publish.yml` 在推送 `v*` tag 时执行：两个系统上跑测试 → 等 `npm` environment 的审批人批准 → `npm pack` 一次 → 带 provenance 发布**这个 tarball** → 核对 npm 上的 integrity 与本地一致 → 把同一个 tarball 和 `SHA256SUMS` 挂到 GitHub Release。
> 状态（2026-10-25）：**未发布**。下面「阻断项」未清零前不要推 tag。

## 阻断项

| # | 项 | 现状 | 谁来做 |
|---|---|---|---|
| 1 | **仓库可见性**：npm provenance 只给公开仓库签发；私有仓库带 `--provenance` 发布会直接失败（workflow 故意这样，避免无 attestation 发出去） | `dogeuni-org/dogeuni-mcp` 是 **PRIVATE** | 维护者决定是否公开（GitHub Settings → Visibility）。不公开就只能放弃 provenance，需要改 workflow 并改 README/设计文档里的承诺 |
| 2 | **钱包先上架**：MCP 只有在钱包实现了 agent 协议（P2a–P2c）时才有用 | 商店版是 1.4.19，不含 P2 | 先发一个带 P2 的钱包版本（设置页仍不挂入口），等 CWS 上线 |
| 3 | **最低钱包版本**：README 写明「需要 DogeUni Wallet ≥ x.y.z」 | README 只写了 Node / 系统 / Chrome | 第 2 项版本号确定后补 |
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

1. `main` 干净；`npm test` 全绿（当前 45/45，只在 macOS 上跑过；Linux 由 workflow 的测试矩阵首次验证）。
2. 改 `package.json` 的 `version`（`src/version.js` 从它读取）；`docs/protocol.md` 与钱包 `ai-wallet-p2-plan.md` §2.1 一致。
3. `npm pack --dry-run`：只应有 `bin/ src/ docs/ README.md LICENSE package.json`（0.1.0 时 18 个文件、23.8 kB）。
4. 提交，打 tag：`git tag v<version>` → `git push origin main v<version>`。
5. 在 Actions 里批准 `npm` environment；workflow 会：发布 → 核对 `dist.integrity` → 建 Release（tarball + `SHA256SUMS`）。
6. 发布后在 npm 页面确认有 Provenance 标记，并按下面「用户如何校验」走一遍。

## 用户如何校验

```sh
npm view dogeuni-mcp@<version> dist.integrity      # 与 Release 里 tarball 的 sha512 一致
shasum -a 256 -c SHA256SUMS                         # 下载 Release 的 tarball 和 SHA256SUMS 后
npm audit signatures                                # 在装了 dogeuni-mcp 的项目里：校验 registry 签名和 provenance
```

## 不在本清单范围

- 钱包「已连接的 agent」页显示 MCP 版本：未做（设计文档 §4.4）。
- 设置页挂 Agent 入口：npm 发布之后的钱包版本做。
