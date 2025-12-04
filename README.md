# ChatGPT Multimodal Exporter

一个基于 vite-plugin-monkey 的 Tampermonkey / Violentmonkey 用户脚本，用来在 chatgpt.com / chat.openai.com 上导出对话 JSON，并尽可能抓取会话中的多模态资源（附件、图片指针、音频、沙盒文件等），支持单聊导出与批量导出。

## 功能特点
- 当前对话一键导出 JSON，文件名自动包含会话标题和 conversation_id。
- 识别并下载可用文件：用户上传附件、内容引用的 file_id、asset_pointer（包含画布/图片）、sandbox: 链接、内联 {{file:xxx}} 占位符、语音模式的音频指针等。
- 批量导出：拉取个人会话和项目/助手会话列表，选择后生成 ZIP，包含分组的 JSON、附件以及 summary.json（失败项、映射关系、统计）。
- 自动获取凭证：通过 /api/auth/session 和账号 cookie 获取 accessToken、accountId，UI 徽标实时显示状态。
- 内置悬浮按钮，无需打开控制台即可操作；所有下载通过 GM_download / GM_xmlhttpRequest 完成。
- 代码已按模块拆分（api、cred、utils、files、downloads、conversations、batchExport、ui），便于二次开发。

## 安装与开发
### 环境要求
- Node.js 18+ 建议
- 推荐使用 pnpm（仓库自带 pnpm-lock.yaml），也可用 npm / yarn

### 本地开发
```bash
pnpm install
pnpm dev
```
1. `pnpm dev` 后，浏览器会打开形如 `http://localhost:5173/chatgpt-multimodal-exporter.user.js` 的地址，按提示在 Tampermonkey / Violentmonkey 中安装开发版脚本。
2. 在 chatgpt.com 打开任意页面，脚本会在右下角出现三个按钮。修改 `src` 代码保存后刷新即可看到效果（HMR）。

### 构建发布
```bash
pnpm build
```
产物位于 `dist/chatgpt-multimodal-exporter.user.js`，将该文件作为正式脚本发布或手动安装即可。

## 使用说明
### 悬浮控件
- 导出 JSON（左侧按钮）：在包含 `/c/{id}` 的对话页点击，自动保存当前对话 JSON。
- 下载文件（中间按钮）：扫描当前对话可识别文件并弹窗展示，勾选后顺序下载。
- 批量导出（右侧按钮）：拉取个人和项目会话列表，可全选/分组选择，勾选“包含附件”后生成 ZIP。

### 批量导出产物结构
- `json/`：个人会话的 JSON 文件。
- `attachments/`：个人会话的附件，按会话前缀分目录。
- `projects/{project_name}/json/` 与 `projects/{project_name}/attachments/`：项目/助手会话的分组输出。
- `summary.json`：包含导出时间、会话统计、附件映射、失败记录，便于审计或二次处理。

### 多模态/文件覆盖范围
- meta.attachments 中的上传文件。
- content_references_by_file、n7jupd_crefs_by_file 里的 file_id 引用。
- content.parts 中的 asset_pointer（图片、画布）、real_time_user_audio_video_asset_pointer、audio_asset_pointer。
- 文本中的 `{{file:xxx}}` 占位符与 `sandbox:` 链接。
- 直接可下载的 CDN 指针（如 oaidalleapiprodscus、cdn.oaistatic）。

## 目录结构速览
- `src/main.ts`：脚本入口，挂载 UI。
- `src/ui.ts`：悬浮按钮、弹窗和交互逻辑。
- `src/cred.ts`：凭证获取与调试信息。
- `src/api.ts`：会话、沙盒、文件下载元数据请求。
- `src/files.ts`：从会话数据中提取候选文件/图片。
- `src/downloads.ts`：文件与指针的下载实现（含 sandbox）。
- `src/conversations.ts`：会话列表收集、批量拉取。
- `src/batchExport.ts`：批量导出 ZIP、summary.json 生成。
- `vite.config.ts`：vite + vite-plugin-monkey 配置。

## 常见问题与提示
- 必须在已登录的 chatgpt.com / chat.openai.com 页面使用，否则无法获取 accessToken。
- 项目/助手会话需在对应项目路径下访问，以便带上 `chatgpt-project-id` 头部。
- 如果某些文件下载失败，可在控制台查看具体报错，summary.json 也会记录失败项。
- Deep Research 报告（docx/pdf）导出暂未实现。

## TODOs
- [x] Uploaded attachments
- [x] Sandbox
- [x] Images
- [x] Canvas Mode (download does not require api)
- [x] Agent Mode (nothing to download)
- [ ] Deep Research Report Export (docx, pdf)
- [x] Voice Mode
- [x] 以上功能在项目中的实现

## 授权
本仓库未声明许可证，使用和分发前请先与作者确认。
