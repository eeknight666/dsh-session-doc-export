# 更新日志

## 0.1.0 — 2026-11-24

首个版本。

### 功能

- 会话页右上角「导出」按钮：格式（Markdown / HTML / JSON）× 内容（仅对话 / 对话 + 轨迹）× 范围（当前会话 / 选择会话）三档选择。
- 「选择会话…」浮层：按工作区（会话 cwd）分组，组头可折叠，支持组内全选、按标题 / id / cwd 搜索；勾选多个会话后打包成 ZIP，单会话一个文件。
- `/export-doc` 命令：`/export-doc [格式] [档位] [all]`。
- 路由 `GET/HEAD /api/session.export-doc`，支持 `?list=1`（会话骨架）、`?titles=1&ids=`（折叠标题）、`?sessionId=`（单会话）、`?sessionIds=`（勾选 ZIP）、`?scope=all`（全部 ZIP）。

### 实现

- 零运行时依赖：Markdown / HTML 渲染和 `lib/zip.js` 打包器（store / deflate，UTF-8 文件名）都是自带的。
- 「仅对话」会剔掉注入进会话历史的审批通知、运行时快照、技能目录、记忆召回。
- 单条会话读取失败只跳过并计入 `x-export-skipped`，不拖垮整批；单次导出上限 200 个会话。
