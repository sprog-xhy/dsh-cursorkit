# BLOCKED

> 执行 GOAL / ARCHITECTURE 时遇到的「查不到 / 待核验」项。**先做不依赖它的任务**，核验完成后移出。

| ID | 描述 | 依赖任务 | 状态 |
|---|---|---|---|
| BLOCKED-1 | 工具执行审批（写文件/shell/网络）的 dsh 原生挂起/回执 API：**已关闭**——真实 Service 是 `dsh-user-approval`（`ctx.approval` + `approval/request` waterfall + outcome），见 audit §6.6 | T-017 ApprovalCard | ✅ 已解决（2026-09-08 复审，adapter 落地 + 5 测试） |
| BLOCKED-2 | dsh `web`/`tui` profile 之外的自建 profile 文件最小格式（是否需要 `cordis.patch.yml` 单文件即可）——需用 `--dump-config` 实测。 | T-010 host-dsh 启动 | 待核验 |

## 关闭记录

无。
