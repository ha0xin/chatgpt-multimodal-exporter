import { escapeHtml, escapeHtmlAttr } from './utils';
import { VIRTUAL_ROOT_ID } from './tree';
import type { RenderedAttachment, RenderedNode } from './types';

function renderAttachments(atts: RenderedAttachment[]): string {
    if (atts.length === 0) return '';
    return `<div class="attachments">
        ${atts.map(a => {
        if (a.isImage) {
            return `<img src="${a.url}" alt="${escapeHtml(a.name)}" />`;
        }
        return `<a href="${a.url}" download="${a.name}" class="file-attachment">📎 ${escapeHtml(a.name)}</a>`;
    }).join('')}
    </div>`;
}

export function renderHtmlDocument(
    title: string,
    renderedNodes: RenderedNode[],
    selectedByParent: Record<string, string>
): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            --bg-color: #ffffff;
            --text-color: #0d0d0d;
            --user-bg: #f4f4f4;
            --border-color: #e5e5e5;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg-color: #1e1e1e;
                --text-color: #ececec;
                --user-bg: #2f2f2f;
                --border-color: #444;
            }
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding-bottom: 50px;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 20px;
        }

        .header h1 {
            font-size: 1.5rem;
            margin: 0;
        }

        .message {
            margin-bottom: 24px;
            display: flex;
            flex-direction: column;
        }

        .message.user .bubble {
            background-color: var(--user-bg);
            border-radius: 20px;
            padding: 10px 20px;
            align-self: flex-end;
            max-width: 90%;
            margin-left: auto;
        }

        .message.assistant .bubble {
            background-color: transparent;
            padding: 0;
            max-width: 100%;
            align-self: flex-start;
        }
        
        .message.system .bubble {
            background-color: #fff3cd;
            color: #856404;
            border-radius: 8px;
            padding: 10px;
            font-size: 0.9em;
            text-align: center;
            align-self: center;
        }

        .message .bubble-toolbar {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 0.85em;
            color: #666;
            margin-top: 6px;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-2px);
            transition: opacity 0.15s ease, transform 0.15s ease;
        }

        .message:hover .bubble-toolbar,
        .message:focus-within .bubble-toolbar {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        @media (hover: none) {
            .message .bubble-toolbar {
                opacity: 1;
                visibility: visible;
                transform: none;
            }
        }

        .message.user .bubble-toolbar {
            align-self: flex-end;
        }

        .message.assistant .bubble-toolbar,
        .message.tool .bubble-toolbar {
            align-self: flex-start;
            flex-direction: row-reverse;
        }

        .toolbar-btn {
            border: none;
            background: transparent;
            color: inherit;
            padding: 4px;
            border-radius: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease, color 0.15s ease;
        }

        .toolbar-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }

        @media (prefers-color-scheme: dark) {
            .toolbar-btn:hover {
                background: rgba(255, 255, 255, 0.08);
            }
        }

        .toolbar-btn:disabled {
            opacity: 0.4;
            cursor: default;
        }

        .toolbar-btn.copied {
            color: #10a37f;
        }

        .toolbar-icon {
            width: 16px;
            height: 16px;
        }

        .branch-controls {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .branch-count {
            min-width: 38px;
            text-align: center;
            font-variant-numeric: tabular-nums;
            color: #444;
        }

        @media (prefers-color-scheme: dark) {
            .branch-count {
                color: #ccc;
            }
        }

        .content p {
            margin: 0.5em 0;
        }
        .content p:first-child {
            margin-top: 0;
        }
        .content p:last-child {
            margin-bottom: 0;
        }

        .content img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 10px 0;
            display: block;
        }

        .code-block {
            border: 1px solid var(--border-color);
            border-radius: 10px;
            margin: 12px 0;
            background: transparent;
        }

        .code-block[data-collapsed="true"] {
            max-height: var(--code-max-height, 50vh);
            overflow-y: auto;
            overflow-x: hidden;
        }

        .code-block[data-collapsed="false"] {
            max-height: none;
            overflow: visible;
        }

        .code-header {
            position: sticky;
            top: 0;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 6px 10px;
            font-size: 0.85em;
            background: var(--bg-color);
            border-bottom: 1px solid var(--border-color);
        }

        .code-block[data-collapsed="false"] .code-header {
            position: static;
        }

        .code-title {
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            color: #666;
            letter-spacing: 0.02em;
        }

        @media (prefers-color-scheme: dark) {
            .code-title {
                color: #aaa;
            }
        }

        .code-actions {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .code-btn {
            border: 1px solid var(--border-color);
            background: transparent;
            color: inherit;
            padding: 2px 8px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
        }

        .code-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }

        @media (prefers-color-scheme: dark) {
            .code-btn:hover {
                background: rgba(255, 255, 255, 0.08);
            }
        }

        .code-btn.copied {
            color: #10a37f;
            border-color: #10a37f;
        }

        pre {
            background-color: transparent;
            border: none;
            border-radius: 0;
            padding: 12px;
            overflow-x: auto;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            font-size: 0.9em;
            margin: 0;
        }

        code {
            background-color: transparent;
            padding: 0;
            border-radius: 0;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            font-size: 0.9em;
        }

        :not(pre) > code {
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 1px 4px;
        }

        blockquote {
            border-left: 4px solid var(--border-color);
            margin: 0;
            padding-left: 16px;
            color: #777;
        }

        .image-carousel {
            display: flex;
            gap: 10px;
            overflow-x: auto;
            padding: 10px 0;
            scroll-behavior: smooth;
        }
        .image-carousel::-webkit-scrollbar {
            height: 6px;
        }
        .image-carousel::-webkit-scrollbar-thumb {
            background-color: #ccc;
            border-radius: 3px;
        }
        .image-card {
            position: relative;
            flex-shrink: 0;
        }
        .image-card img {
            height: 200px;
            width: auto;
            object-fit: cover;
            border-radius: 8px;
            display: block;
            margin: 0;
        }

        .canvas-block {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin: 10px 0;
            overflow: hidden;
        }

        .canvas-header {
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
            font-weight: bold;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
            background: var(--bg-color);
        }

        .canvas-badge {
            color: #888;
            font-weight: normal;
        }

        .canvas-body {
            padding: 0;
        }
        .image-source {
            position: absolute;
            left: 50%;
            bottom: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.7);
            color: #111;
            font-size: 0.75em;
            text-decoration: none;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            max-width: calc(100% - 16px);
            box-sizing: border-box;
            transform: translateX(-50%);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease;
        }
        .image-card:hover .image-source,
        .image-card:focus-within .image-source {
            opacity: 1;
            pointer-events: auto;
        }
        .image-source img {
            width: 14px;
            height: 14px;
            border-radius: 3px;
            flex-shrink: 0;
        }
        .image-source span {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px;
        }

        @media (prefers-color-scheme: dark) {
            .image-source {
                background: rgba(0, 0, 0, 0.55);
                color: #f0f0f0;
            }
        }

    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${escapeHtml(title)}</h1>
        </div>
        <div class="chat-log">
            ${renderedNodes.map(m => `
                <div class="message ${m.role}" data-node-id="${escapeHtmlAttr(m.id)}" data-parent-id="${escapeHtmlAttr(m.parentId)}" data-raw="${escapeHtmlAttr(m.rawText)}">
                    <div class="bubble">
                        <div class="content">
                            ${m.htmlContent}
                        </div>
                        ${renderAttachments(m.attachments)}
                    </div>
                    <div class="bubble-toolbar">
                        <button class="toolbar-btn" data-action="copy" title="复制原始内容" aria-label="复制原始内容">
                            <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H10V7h9v14z"/>
                            </svg>
                        </button>
                        <div class="branch-controls">
                            <button class="toolbar-btn" data-action="prev" title="上一版本" aria-label="上一版本">
                                <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                                </svg>
                            </button>
                            <span class="branch-count">1/1</span>
                            <button class="toolbar-btn" data-action="next" title="下一版本" aria-label="下一版本">
                                <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path fill="currentColor" d="m8.59 16.59 1.41 1.41 6-6-6-6-1.41 1.41L13.17 12z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    <script>
        (() => {
            const ROOT_ID = ${JSON.stringify(VIRTUAL_ROOT_ID)};
            const selectedByParent = ${JSON.stringify(selectedByParent)};
            const messageEls = Array.from(document.querySelectorAll('.message[data-node-id]'));
            const childrenByParent = new Map();

            messageEls.forEach((el) => {
                const nodeId = el.dataset.nodeId || '';
                const parentId = el.dataset.parentId || ROOT_ID;
                if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
                childrenByParent.get(parentId).push(nodeId);
            });

            const getSelectedChild = (parentId) => {
                const children = childrenByParent.get(parentId) || [];
                if (!children.length) return null;
                const selected = selectedByParent[parentId];
                if (selected && children.includes(selected)) return selected;
                return children[0];
            };

            const updateBranchControls = () => {
                messageEls.forEach((el) => {
                    const nodeId = el.dataset.nodeId || '';
                    const parentId = el.dataset.parentId || ROOT_ID;
                    const siblings = childrenByParent.get(parentId) || [];
                    const total = siblings.length;
                    const index = Math.max(0, siblings.indexOf(nodeId));
                    const countEl = el.querySelector('.branch-count');
                    if (countEl) countEl.textContent = total ? (index + 1) + '/' + total : '1/1';
                    const prevBtn = el.querySelector('[data-action="prev"]');
                    const nextBtn = el.querySelector('[data-action="next"]');
                    if (prevBtn) prevBtn.disabled = total <= 1 || index <= 0;
                    if (nextBtn) nextBtn.disabled = total <= 1 || index >= total - 1;
                });
            };

            const updateVisibility = () => {
                const visible = new Set();
                const walk = (parentId) => {
                    const child = getSelectedChild(parentId);
                    if (!child) return;
                    visible.add(child);
                    walk(child);
                };
                walk(ROOT_ID);
                messageEls.forEach((el) => {
                    const nodeId = el.dataset.nodeId || '';
                    el.style.display = visible.has(nodeId) ? '' : 'none';
                });
                updateBranchControls();
            };

            const setCodeToggleState = (block, btn, collapsed) => {
                block.dataset.collapsed = collapsed ? 'true' : 'false';
                btn.textContent = collapsed ? '展开' : '收起';
                btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            };

            const setupCodeBlocks = () => {
                const maxHeight = Math.round(window.innerHeight * 0.5);
                const blocks = document.querySelectorAll('pre > code');
                blocks.forEach((codeEl) => {
                    const pre = codeEl.parentElement;
                    if (!pre || pre.closest('.code-block')) return;
                    const wrapper = document.createElement('div');
                    wrapper.className = 'code-block';
                    wrapper.style.setProperty('--code-max-height', maxHeight + 'px');

                    const header = document.createElement('div');
                    header.className = 'code-header';

                    const title = document.createElement('span');
                    title.className = 'code-title';
                    const match = (codeEl.className || '').match(/language-([a-z0-9_-]+)/i);
                    title.textContent = match ? match[1].toUpperCase() : 'CODE';

                    const actions = document.createElement('div');
                    actions.className = 'code-actions';

                    const copyBtn = document.createElement('button');
                    copyBtn.type = 'button';
                    copyBtn.className = 'code-btn';
                    copyBtn.setAttribute('data-code-action', 'copy');
                    copyBtn.textContent = '复制';

                    const toggleBtn = document.createElement('button');
                    toggleBtn.type = 'button';
                    toggleBtn.className = 'code-btn';
                    toggleBtn.setAttribute('data-code-action', 'toggle');
                    toggleBtn.textContent = '展开';
                    toggleBtn.setAttribute('aria-expanded', 'false');

                    actions.append(copyBtn, toggleBtn);
                    header.append(title, actions);

                    pre.parentNode.insertBefore(wrapper, pre);
                    wrapper.append(header, pre);

                    const needsCollapse = pre.scrollHeight > maxHeight;
                    if (needsCollapse) {
                        setCodeToggleState(wrapper, toggleBtn, true);
                    } else {
                        wrapper.dataset.collapsed = 'false';
                        toggleBtn.hidden = true;
                    }
                });
            };

            document.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                const messageEl = btn.closest('.message');
                if (!messageEl) return;
                const nodeId = messageEl.dataset.nodeId || '';
                const parentId = messageEl.dataset.parentId || ROOT_ID;
                const siblings = childrenByParent.get(parentId) || [];
                const index = siblings.indexOf(nodeId);
                if (action === 'copy') {
                    const raw = messageEl.dataset.raw || '';
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(raw).then(() => {
                            btn.classList.add('copied');
                            setTimeout(() => btn.classList.remove('copied'), 900);
                        }).catch(() => {
                        });
                    } else {
                        const helper = document.createElement('textarea');
                        helper.value = raw;
                        helper.style.position = 'fixed';
                        helper.style.opacity = '0';
                        document.body.appendChild(helper);
                        helper.select();
                        try { document.execCommand('copy'); } catch (e) {}
                        document.body.removeChild(helper);
                        btn.classList.add('copied');
                        setTimeout(() => btn.classList.remove('copied'), 900);
                    }
                    return;
                }
                if (action === 'prev' && index > 0) {
                    selectedByParent[parentId] = siblings[index - 1];
                    updateVisibility();
                }
                if (action === 'next' && index >= 0 && index < siblings.length - 1) {
                    selectedByParent[parentId] = siblings[index + 1];
                    updateVisibility();
                }
            });

            document.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-code-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-code-action');
                const block = btn.closest('.code-block');
                if (!block) return;
                if (action === 'copy') {
                    const codeEl = block.querySelector('code');
                    const text = codeEl ? (codeEl.textContent || '') : '';
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(() => {
                            btn.classList.add('copied');
                            setTimeout(() => btn.classList.remove('copied'), 900);
                        }).catch(() => {
                        });
                    } else {
                        const helper = document.createElement('textarea');
                        helper.value = text;
                        helper.style.position = 'fixed';
                        helper.style.opacity = '0';
                        document.body.appendChild(helper);
                        helper.select();
                        try { document.execCommand('copy'); } catch (e) {}
                        document.body.removeChild(helper);
                        btn.classList.add('copied');
                        setTimeout(() => btn.classList.remove('copied'), 900);
                    }
                    return;
                }
                if (action === 'toggle') {
                    const collapsed = block.dataset.collapsed !== 'true';
                    setCodeToggleState(block, btn, collapsed);
                }
            });

            const normalizeWheelDelta = (event, target) => {
                const absX = Math.abs(event.deltaX || 0);
                const absY = Math.abs(event.deltaY || 0);
                let delta = absX > absY ? event.deltaX : event.deltaY;
                if (!delta) return 0;
                if (event.deltaMode === 1) delta *= 16;
                if (event.deltaMode === 2) delta *= target.clientWidth;
                return delta;
            };

            document.addEventListener('wheel', (event) => {
                if (event.ctrlKey) return;
                const target = event.target;
                if (!(target instanceof Element)) return;
                const carousel = target.closest('.image-carousel');
                if (!carousel) return;
                const maxScroll = carousel.scrollWidth - carousel.clientWidth;
                if (maxScroll <= 0) return;
                const delta = normalizeWheelDelta(event, carousel);
                if (!delta) return;
                const prev = carousel.scrollLeft;
                let next = prev + delta;
                if (next < 0) next = 0;
                if (next > maxScroll) next = maxScroll;
                if (next === prev) return;
                carousel.scrollLeft = next;
                event.preventDefault();
            }, { passive: false });

            setupCodeBlocks();
            updateVisibility();
        })();
    </script>
</body>
</html>`;
}
