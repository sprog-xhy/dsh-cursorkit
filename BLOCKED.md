# BLOCKED

> 执行 GOAL / ARCHITECTURE 时遇到的「查不到 / 待核验」项。**先做不依赖它的任务**，核验完成后移出。

| ID | 描述 | 依赖任务 | 状态 |
|---|---|---|---|
| BLOCKED-1 | 工具执行审批的 dsh 原生挂起/回执 API | T-017 ApprovalCard | ✅ 已解决（`dsh-user-approval`：`ctx.approval` + `approval/request` waterfall，见 audit §6.6） |
| BLOCKED-2 | 自建 profile 最小文件格式 | T-010 host-dsh 启动 | ✅ 已解决（实测：`$DSH_HOME/profiles/<name>/` + `package.json#dsh.profile.bundles` + `cordis.patch.yml`；`dsh --dump-config` 可验证；host 插件行可 insert，agent-loop 用顶层 id override） |

## 关闭记录

无。
