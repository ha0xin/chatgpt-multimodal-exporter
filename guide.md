简单说，你要做两件事：

1. 用 `vite-plugin-monkey` 搭一个工程化环境；
2. 把现在这个超长的油猴脚本搬进去，改成模块化代码。

我分步骤带你来一遍（偏 TypeScript / ESModule 的写法，如果你只想用 JS 也一样）。

---

## 1️⃣ 初始化 vite-plugin-monkey 项目

先在一个空目录里初始化项目：

```bash
# 推荐用 npm
npm create monkey@latest

# 或者：
# pnpm create monkey
# yarn create monkey
```

交互里随便选一个你顺手的模板，比如你只是写脚本逻辑、没有 UI 的话：

* `empty`（纯 JS）
* **`empty-ts`（纯 TS，推荐）** ([GitHub][1])

生成完之后，你会得到类似结构：

```text
my-monkey-project/
  src/
    main.ts         # 用户脚本入口
  vite.config.ts    # vite + vite-plugin-monkey 配置
  package.json
```

如果你不是用 `create monkey`，而是想从已有 Vite 项目改造，那就：

```bash
npm i -D vite-plugin-monkey
```

然后在 `vite.config.ts` 里手动加插件（一定要放在 plugin 数组的最后一个）([GitHub][2])：

```ts
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    // ...其他插件
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'ChatGPT-Multimodal-Exporter',
        namespace: 'chatgpt-multimodal-exporter',
        version: '0.3.0',
        description: '导出对话 json + 会话中的多模态文件（图片、音频、sandbox 文件等）',
        match: [
          'https://chatgpt.com/*',
          'https://chat.openai.com/*',
        ],
        runAt: 'document-end',
        // 你可以显式写 grant，也可以让 vite-plugin-monkey autoGrant 自动识别 GM_* 后补充
        grant: [
          'GM_download',
          'GM_xmlhttpRequest',
        ],
      },
    }),
  ],
});
```

---

## 2️⃣ 安装依赖（JSZip + GM API 类型）

你的脚本里用了：

* `GM_download`
* `GM_xmlhttpRequest`
* `jszip`（通过 @require 的 CDN）

在 vite-plugin-monkey 环境下**不再需要 `@require jszip`**，直接走 npm 包就行：

```bash
npm i jszip
# 如果用 TypeScript，可以顺手装一下类型
npm i -D @types/greasemonkey
```

vite-plugin-monkey 推荐的 GM API 使用方式，是从它的 client 包里按需 import：([GitHub][1])

```ts
// src/main.ts
import { GM_download, GM_xmlhttpRequest } 
  from 'vite-plugin-monkey/dist/client';

import JSZip from 'jszip';
```

> 它会自动分析你用了哪些 GM_*，并在生成的 userscript 头部自动加 `@grant`，也可以像上面配置里那样手动写。([CSDN博客][3])

### （可选）类型提示

如果你用 TS，可以在 `src/vite-env.d.ts` 里加一行，获得 GM_* 的类型提示：([GitHub][1])

```ts
/// <reference types="vite-plugin-monkey/client" />
```

---

## 3️⃣ 把油猴脚本搬进 `src/main.ts`

现在你这个脚本大概结构是：

```js
// ==UserScript==
// ... 一堆 @xxx 元数据
// ==/UserScript==

(function () {
  // 全局工具 U
  const U = { ... };

  // 凭证模块 Cred = (() => { ... })();

  // 一堆函数：fetchConversation、downloadSandboxFile、gmDownload 等

  function boot() { ... }

  boot();
})();
```

迁移思路：

1. **删掉整个 `// ==UserScript== ... ==/UserScript==` 区段**
   这些 meta 以后全部由 `vite.config.ts` 里的 `userscript` 配置生成。

2. 保留 IIFE 里的内容，**去掉最外层 `(function () {` 和最后的 `})();`**，变成正常的模块代码：

   ```ts
   // src/main.ts

   import { GM_download, GM_xmlhttpRequest } 
     from 'vite-plugin-monkey/dist/client';
   import JSZip from 'jszip';

   // --- 小工具函数 -------------------------------------------------
   const U = {
     // 原样粘过来...
   };

   const BATCH_CONCURRENCY = 4;
   const LIST_PAGE_SIZE = 50;

   const Cred = (() => {
     // ... 原来的凭证模块
   })();

   // ... 下面所有函数全部原样复制

   function boot() {
     // 原来的 boot 函数
   }

   // 脚本入口
   boot();
   ```

3. **GM_* 函数不需要改名字**
   你的 `gmDownload` / `gmFetchBlob` 等封装里用到 `GM_download` / `GM_xmlhttpRequest`，只要在顶部用 `import` 引入，就跟原来一样可以直接用。

4. `JSZip` 直接用 npm 版即可：

   ```ts
   import JSZip from 'jszip';

   // 下面 runBatchExport 里直接使用 JSZip 就行：
   const zip = new JSZip();
   ```

5. 原来的 `@require jszip` 这行从元数据里去掉（现在已经在 code 里通过 `import JSZip` 解决）。

---

## 4️⃣（顺手优化）把庞大脚本拆模块

现在已经是 ESModule 了，可以把这么长的逻辑拆成几个文件，方便维护。例如：

```text
src/
  main.ts           // 入口：boot，mountUI
  utils.ts          // U, saveBlob, saveJSON 等
  cred.ts           // Cred 模块
  api.ts            // fetchConversation / sandbox / listConversations...
  files.ts          // collectFileCandidates、下载相关
  batchExport.ts    // runBatchExport 及批量逻辑
  ui.ts             // 各种 Dialog 和右下角按钮 UI
```

示例（以 utils 为例）：

```ts
// src/utils.ts
export const U = {
  qs: (s: string, r: Document | HTMLElement = document) => r.querySelector(s),
  ce: (t: string, props: any = {}, attrs: Record<string, string> = {}) => {
    const el = document.createElement(t);
    Object.assign(el, props);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  },
  // ... 其他工具函数
};

export function saveBlob(blob: Blob, filename: string) { ... }
export function saveJSON(obj: any, filename: string) { ... }
```

然后入口文件里：

```ts
// src/main.ts
import { GM_download, GM_xmlhttpRequest } 
  from 'vite-plugin-monkey/dist/client';
import JSZip from 'jszip';

import { U, saveBlob, saveJSON } from './utils';
import { Cred } from './cred';
import { fetchConversation, downloadSandboxFile, ... } from './api';
import { runBatchExport } from './batchExport';
import { mountUI } from './ui';

function boot() {
  mountUI();
}

boot();
```

（这步纯属提升可维护性，不是必须）

---

## 5️⃣ 开发 & 调试（带 HMR）

`package.json` 里会自动带有类似脚本：([GitHub][1])

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### 开发模式

```bash
npm run dev
```

* vite-plugin-monkey 会起一个 dev server；
* 第一次启动 / 修改 `userscript` 配置时，会自动在浏览器打开一个 `*.user.js` 地址（比如 `http://localhost:5173/xxx.user.js`）；
* Tampermonkey / Violentmonkey 会提示你安装这个 **dev 脚本**（名字一般是 `dev:xxx`）；([GitHub][1])
* 安装后，只要你改 `src` 里的代码，页面刷新 / HMR 就会自动生效，比现在手改用户脚本那套舒服多了。

### 打包发布

```bash
npm run build
```

构建产物会在 `dist/` 下生成：

* `xxx.user.js`：真正给油猴安装的脚本
* 可选：`xxx.meta.js`（如果配置了 `metaFileName: true`，用于自动更新）([DeepWiki][4])

把 `xxx.user.js` 传到你现在使用的脚本源（本地 / GreasyFork / 自建等）即可。

---

## 6️⃣ 简明小结（Checklist）

1. ✅ `npm create monkey@latest` → 选 `empty-ts`

2. ✅ `npm i jszip`

3. ✅ `vite.config.ts` 里配置 `monkey({ entry: 'src/main.ts', userscript: {...} })`

4. ✅ 删除原脚本的 `// ==UserScript==` 区块

5. ✅ 把 IIFE 里面的代码粘到 `src/main.ts`，去掉最外层 `(function(){})()`

6. ✅ 顶部加：

   ```ts
   import { GM_download, GM_xmlhttpRequest } 
     from 'vite-plugin-monkey/dist/client';
   import JSZip from 'jszip';
   ```

7. ✅ 保留原有逻辑，必要时拆成多个模块

8. ✅ `npm run dev` 调试，`npm run build` 出最终 `.user.js`

---

如果你愿意，我也可以直接帮你把这份脚本按「入口 + utils + api + ui」拆成几个 ts 文件的模板，你只需要复制进项目即可。

[1]: https://github.com/lisonge/vite-plugin-monkey/blob/main/README.md?utm_source=chatgpt.com "vite-plugin-monkey/README.md at main - GitHub"
[2]: https://github.com/lisonge/vite-plugin-monkey?utm_source=chatgpt.com "GitHub - lisonge/vite-plugin-monkey: A vite plugin server and build ..."
[3]: https://blog.csdn.net/gitblog_01179/article/details/141082606?utm_source=chatgpt.com "vite-plugin-monkey 使用教程-CSDN博客"
[4]: https://deepwiki.com/lisonge/vite-plugin-monkey/4.1-basic-example?utm_source=chatgpt.com "Basic Example | lisonge/vite-plugin-monkey | DeepWiki"
