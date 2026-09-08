# cursorkit 测试 profile 模板（T-020 复现用）

真实 dsh sidecar 集成验收的 profile 配置模板。复制到 `$DSH_HOME/profiles/cursorkit/` 使用。

## 文件

- `cordis.patch.yml`：插入 host 插件 + 配置 demo-agent（provider 需按环境调整）
- `package.json`：`dsh.profile.bundles: ["@deepseek-ai/dsh-base"]` + host-dsh/protocol 的 file: 依赖

## 步骤（对应 M1-acceptance-report）

1. `mkdir -p $HOME/.dsh-cursorkit-test/profiles/cursorkit`
2. 复制本目录文件过去，把 `package.json` 里的 `<abs-path-to-repo>` 换成仓库绝对路径
3. `DSH_HOME=$HOME/.dsh-cursorkit-test pnpm install`（在 profile 目录）
4. 配置 LLM：`$DSH_HOME/settings.yaml` 声明 `llm-pi-ai.providers.<name>`（手写路由：baseURL + apiKeyEnv + models），`$DSH_HOME/.credentials.yaml` 存 `refs.<API_KEY_ENV>`（0600）
   - 参考主环境 `~/.dsh/settings.yaml` 的 wps provider（`https://ai-kas.kso.net/codeplan/v1`，deepseek/deepseek-v4-flash-0731）
   - ⚠️ settings.yaml 直接复制，不要用脚本重写（`off: null` 会被 YAML 1.1 转成 false 破坏 schema）
5. `DSH_HOME=... dsh --profile cursorkit` 起 sidecar
6. `DSH_HOME=... node scripts/run-acceptance.mjs`

## 注意

- 每次改 host-dsh 代码后：`pnpm --filter @dsh-cursorkit/host-dsh build` + profile 目录 `pnpm install`（刷新 file: 链接）
- agent 消息格式：`source: {kind:'user'}` + `content:[{type:'text',text}]`（缺 source 会崩）
- 旧会话存储（`$DSH_HOME/sessions/`）残留旧格式消息会导致 agent 恢复崩溃 → 清理后重建
