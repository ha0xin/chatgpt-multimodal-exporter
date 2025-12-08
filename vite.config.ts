import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import monkey, { cdn } from 'vite-plugin-monkey';
import packageJson from './package.json'

export default defineConfig({
  plugins: [
    preact(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'ChatGPT-Multimodal-Exporter',
        namespace: 'chatgpt-multimodal-exporter',
        author: packageJson.author,
        description: packageJson.description,
        license: packageJson.license,
        icon: 'https://chat.openai.com/favicon.ico',
        match: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
        'run-at': 'document-end',
        grant: ['GM_download', 'GM_xmlhttpRequest'],
        connect: 'oaiusercontent.com'
      },
      build: {
        fileName: 'chatgpt-multimodal-exporter.user.js',
        externalGlobals: {
          preact: cdn.jsdelivr('preact', 'dist/preact.min.js'),

        },
      },
    }),
  ],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
});
