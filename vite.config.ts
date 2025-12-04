import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import monkey, { cdn } from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    preact(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'ChatGPT-Multimodal-Exporter',
        namespace: 'chatgpt-multimodal-exporter',
        version: '0.5.0',
        author: 'ha0xin',
        description: '导出对话 json + 会话中的多模态文件（图片、音频、sandbox 文件等）',
        icon: 'https://chat.openai.com/favicon.ico',
        match: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
        'run-at': 'document-end',
        grant: ['GM_download', 'GM_xmlhttpRequest'],
      },
      build: {
        fileName: 'chatgpt-multimodal-exporter.user.js',
        externalGlobals: {
          preact: cdn.jsdelivr('preact', 'dist/preact.min.js'),
          jszip: cdn.jsdelivr('JSZip', 'dist/jszip.min.js'),
        },
      },
    }),
  ],
});
