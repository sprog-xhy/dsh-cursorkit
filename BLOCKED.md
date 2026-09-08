# BLOCKED

> 执行 GOAL / ARCHITECTURE 时遇到的「查不到 / 待核验」项。**先做不依赖它的任务**，核验完成后移出。

| ID | 描述 | 依赖任务 | 状态 |
|---|---|---|---|
| BLOCKED-1 | 工具执行审批（写文件/shell/网络）的 dsh 原生挂起/回执 API：0.1.1-rc.2 未发现独立 Service（`dsh-authorization` 是凭据授权非工具审批；`permission-presets` 仅 UI 预置）。CKP 审批展示由 host-dsh 自行实现，不阻塞。 | T-017 ApprovalCard | 已缓解（见 audit §6.5） |
| BLOCKED-2 | dsh `web`/`tui` profile 之外的自建 profile 文件最小格式（是否需要 `cordis.patch.yml` 单文件即可）——需用 `--dump-config` 实测。 | T-010 host-dsh 启动 | 待核验 |

## 关闭记录

无。
