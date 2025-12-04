# 批量导出 JSON 与附件的实现计划

## 目标
- 支持一次性导出多条会话的原始 JSON。
- 支持同时打包导出对应的附件/指针（图片、音频、sandbox 文件等）。
- 输出结构清晰、可取消、可提示进度，避免对现有单聊导出造成破坏。

## 现状速记
- 现有脚本仅支持当前会话：`fetchConversation` 拉取 JSON；`collectFileCandidates` + `downloadPointerOrFile` 处理附件。
- UI 是右下角浮动按钮，提供「导出 JSON」与「下载文件」两个入口。

## 参考项目要点
- `references/qiusheng.user.js`：完善的批量导出流程，覆盖根目录/项目会话、星标与归档组合；使用 JSZip 打包并提供进度与停止；并发拉取会话数据。
- `references/universal.user.js`：支持 workspace 选择与 gizmo 项目枚举，批量下载到 ZIP，文件名去重、并有 token/Account 捕获逻辑。
- `references/chatgpt-exporter`：产品化界面，提供「Export All」对话框、格式选择（JSON/ZIP 等），并支持从 conversations.json 离线导出。

## 方案概要
1) **会话枚举**：组合分页查询项目列表，得到 root 会话与项目会话的任务列表。  
2) **会话抓取**：复用 `fetchConversation`，加入小型并发调度（可配置并发数、指数退避）。输出 map：conversation_id -> 原始 JSON。  
3) **附件收集与下载**：对每条会话运行 `collectFileCandidates`，拉取 download_url 或直接流，兼容 inline CDN 与 sandbox。提供两种输出模式：  
   - 直接逐文件 GM_download（低内存，但触发多次下载）。  
   - JSZip 打包（单 ZIP，结构建议 `json/`、`attachments/<seq>_<title>_<id>/`，sandbox 生成占位 txt 记录 URL/报错）。  
4) **文件结构与命名**：根目录生成 `summary.json`（导出时间、总数、项目/根统计），新增附件映射元数据 `attachments_map`，记录 `pointer/file_id -> 实际保存文件名`（避免下载响应重命名导致不可追溯）；保持文件名可读性，不强行改为指针名。项目放子目录（按项目名+时间戳去重），会话文件名按 `序号_标题_id` 生成，统一 sanitize。  
5) **UI/交互（含手动复选框）**：在现有浮窗新增“批量导出”入口，弹窗列表遵循 chatgpt-exporter 的 Export Conversations 体验：  
   - 列表勾选会话：按 root/项目分组展示，每条会话可勾选/全选/反选；支持搜索/过滤（最小实现先做全选 + 手动勾选）。  
   - 范围：全部/仅当前项目/仅根目录/手动选择。  
   - 内容：仅 JSON / JSON+附件（ZIP）。  
   - 并发/限速配置、进度条与「停止导出」按钮。  
6) **健壮性**：导出前刷新凭证；处理中途可取消；对失败的会话/附件记录到 `summary.json`；对 401/429 重试；大文件下载用 GM_download 规避 CORS。

## 任务拆解
- **A. 架构与工具**：引入 JSZip（@require），抽象 `batchQueue(tasks, concurrency)`；扩展 fetch 重试。  
- **B. 会话枚举**：实现 root/project 列表拉取与去重；产出任务数组与项目元信息。  
- **C. 批量 JSON 导出**：并发拉取会话 JSON，写入 ZIP（或单独下载），生成 summary。  
- **D. 批量附件导出**：基于每条 JSON 提取候选，顺序/并发下载；ZIP 模式下写入文件/占位。  
- **E. UI 与交互**：批量导出弹窗含会话列表复选框（分组+全选），选项、进度/取消；与现有按钮保持样式一致。  
- **F. 验证与文档**：自测根目录+项目会话、有/无附件的场景；更新 README/脚本描述，说明 ZIP 结构、勾选操作与已知限制。

## 风险与待确认
- 大量附件下载的时间与体积是否接受，是否需要尺寸/类型过滤。
- sandbox 下载依赖 message_id，部分历史数据缺少字段时如何兜底（记录失败而不阻断）。
- 如果需要手动选择会话范围，需额外构建列表 UI/搜索，版本一可先省略。
