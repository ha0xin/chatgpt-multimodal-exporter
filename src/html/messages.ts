import { marked } from 'marked';

import { pointerToFileId } from '../utils';
import { sanitizeHtmlContent } from './sanitize';
import {
    escapeHtml,
    getFaviconUrl,
    getHostname,
    getThoughtsText,
    normalizeListIndentation,
    stripChatgptUtm
} from './utils';
import type {
    CanvasState,
    ExportedAttachment,
    RenderedAttachment,
    RenderedMessage
} from './types';

function isImageFile(name: string, mime?: string): boolean {
    if (mime && mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function findExportedAttachment(allAttachments: ExportedAttachment[], key: string): ExportedAttachment | undefined {
    return allAttachments.find((att) =>
        att.file_id === key || att.id === key || att.pointer === key
    );
}

function collectMessageAttachments(
    msg: any,
    allAttachments: ExportedAttachment[],
    textContent: string,
    inlineKeys: Set<string>
): RenderedAttachment[] {
    const out: RenderedAttachment[] = [];
    const seen = new Set<string>();

    const addByKey = (key: string, meta?: any) => {
        const normalized = key ? key.replace('sediment://', '') : '';
        if (!normalized) return;
        if (inlineKeys.has(normalized) || inlineKeys.has(key)) return;

        const found = findExportedAttachment(allAttachments, normalized) || findExportedAttachment(allAttachments, key);
        if (!found) return;

        const name =
            found.saved_as ||
            found.name ||
            found.original_name ||
            meta?.name ||
            meta?.file_name ||
            normalized;
        if (!name) return;

        const url = `attachments/${name}`;
        if (inlineKeys.has(url)) return;

        const uniq = `${found.file_id || found.id || found.pointer || normalized}:${name}`;
        if (seen.has(uniq)) return;
        seen.add(uniq);

        const mime = found.mime || meta?.mime_type || meta?.mime || '';
        out.push({
            url,
            name,
            isImage: isImageFile(name, mime)
        });
    };

    const meta = msg?.metadata || {};
    if (Array.isArray(meta.attachments)) {
        for (const att of meta.attachments) {
            if (!att?.id) continue;
            addByKey(att.id, att);
        }
    }

    const refsByFile = meta.content_references_by_file || meta.n7jupd_crefs_by_file;
    if (refsByFile && !Array.isArray(refsByFile) && typeof refsByFile === 'object') {
        for (const fileId of Object.keys(refsByFile)) {
            addByKey(fileId);
        }
    }

    const refs = Array.isArray(meta.content_references)
        ? meta.content_references
        : (Array.isArray(meta.n7jupd_crefs) ? meta.n7jupd_crefs : []);
    for (const ref of refs) {
        if (ref?.file_id) addByKey(ref.file_id, ref);
        if (ref?.asset_pointer) addByKey(pointerToFileId(ref.asset_pointer), ref);
    }

    const fileTokens = textContent.match(/\{\{file:([^}]+)\}\}/g) || [];
    for (const tok of fileTokens) {
        const fid = tok.slice(7, -2);
        addByKey(fid);
    }

    const sandboxLinks = textContent.match(/sandbox:[^\s)\]]+/g) || [];
    for (const link of sandboxLinks) {
        addByKey(link);
    }

    return out;
}

function renderCitationLink(url: string, title: string, index: number): string {
    const cleanedUrl = stripChatgptUtm(url);
    return `<a href="${escapeHtml(cleanedUrl)}" target="_blank" title="${escapeHtml(title || '')}" style="color: #10a37f; text-decoration: none; font-size: 0.8em; margin: 0 2px; background: #e0f7fa; padding: 2px 5px; border-radius: 4px;">[${index}]</a>`;
}

function applyCanvasUpdates(baseContent: string, updates: any[]): string {
    let updated = baseContent;
    for (const update of updates) {
        const pattern = typeof update?.pattern === 'string' ? update.pattern : '';
        if (!pattern) continue;
        const replacement = typeof update?.replacement === 'string' ? update.replacement : '';
        try {
            const regex = new RegExp(pattern, 'g');
            updated = updated.replace(regex, replacement);
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) {
                console.debug('Invalid canvas update pattern', pattern, e);
            }
        }
    }
    return updated;
}

function renderCanvasBlock(title: string, content: string): string {
    return `
    <div class="canvas-block">
        <div class="canvas-header">
            <span>${escapeHtml(title)}</span>
            <span class="canvas-badge">HTML</span>
        </div>
        <div class="canvas-body">
            ${marked.parse('```html\n' + content + '\n```')}
        </div>
    </div>`;
}

export function getRawMessageText(msg: any, allAttachments: ExportedAttachment[]): string {
    if (!msg?.content) return '';
    const contentType = msg.content.content_type;
    if (contentType === 'thoughts') return getThoughtsText(msg.content);
    if (contentType === 'reasoning_recap') return String(msg.content.content || '');
    let textContent = '';
    if (contentType === 'text' && msg.content.parts) {
        textContent = msg.content.parts.join('\n');
    } else if (contentType === 'multimodal_text' && msg.content.parts) {
        for (const part of msg.content.parts) {
            if (typeof part === 'string') {
                textContent += part + '\n';
            } else if (part.asset_pointer) {
                const fileId = part.asset_pointer.replace('sediment://', '');
                const found = allAttachments.find(a => (a.file_id === fileId || a.id === fileId));
                if (found) {
                    const filename = found.saved_as || found.name || 'image.png';
                    const originalName = found.original_name || found.name || 'Image';
                    const relPath = `attachments/${filename}`;
                    textContent += `\n![${originalName}](${relPath})\n`;
                }
            }
        }
    } else if (typeof msg.content.text === 'string') {
        textContent = msg.content.text;
    } else if (Array.isArray(msg.content.parts)) {
        textContent = msg.content.parts.map((part: any) => typeof part === 'string' ? part : '').join('\n');
    } else if (typeof msg.content.content === 'string') {
        textContent = msg.content.content;
    }
    return textContent;
}

export function renderMessage(msg: any, allAttachments: ExportedAttachment[], canvasState: CanvasState): RenderedMessage {
    const role = msg.author.role;
    let textContent = '';
    const inlineAttachmentKeys = new Set<string>();
    const userImageItems: { url: string; name: string }[] = [];

    if (msg.content) {
        if (msg.content.content_type === 'text' && msg.content.parts) {
            textContent = msg.content.parts.join('\n');
        } else if (msg.content.content_type === 'text' && typeof msg.content.text === 'string') {
            textContent = msg.content.text;
        } else if (msg.content.content_type === 'multimodal_text' && msg.content.parts) {
            for (const part of msg.content.parts) {
                if (typeof part === 'string') {
                    textContent += part + '\n';
                } else if (part.asset_pointer) {
                    const fileId = part.asset_pointer.replace('sediment://', '');
                    const found = allAttachments.find(a => (a.file_id === fileId || a.id === fileId));
                    if (found) {
                        const filename = found.saved_as || found.name || 'image.png';
                        const originalName = found.original_name || found.name || 'Image';
                        const relPath = `attachments/${filename}`;
                        inlineAttachmentKeys.add(fileId);
                        inlineAttachmentKeys.add(relPath);
                        if (role === 'user') {
                            userImageItems.push({ url: relPath, name: originalName });
                        } else {
                            textContent += `\n![${escapeHtml(originalName)}](${relPath})\n`;
                        }
                    }
                }
            }
            if (role === 'user' && userImageItems.length > 0) {
                const carouselItems = userImageItems.map((img) =>
                    `<div class="image-card"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name)}" loading="lazy" /></div>`
                ).join('');
                const carouselHtml = `\n<div class="image-carousel user-images">${carouselItems}</div>\n`;
                textContent += carouselHtml;
            }
        }
    }

    const attachments = collectMessageAttachments(msg, allAttachments, textContent, inlineAttachmentKeys);

    if (msg.metadata?.content_references) {
        const refs = [...msg.metadata.content_references].sort((a: any, b: any) => b.start_idx - a.start_idx);

        for (const ref of refs) {
            if (ref.type === 'image_group' && ref.images) {
                const carouselItems = ref.images.map((img: any) => {
                    const imgUrl = img.image_result?.content_url || img.image_result?.url;
                    if (!imgUrl) return '';
                    const pageUrl = stripChatgptUtm(img.image_result?.url || '');
                    const title = img.image_result?.title || (pageUrl ? getHostname(pageUrl) : 'Image');
                    const favicon = pageUrl ? getFaviconUrl(pageUrl) : '';
                    const sourceHtml = pageUrl ? `<a class="image-source" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">
                            ${favicon ? `<img src="${escapeHtml(favicon)}" alt="" aria-hidden="true" onerror="this.style.display='none';" />` : ''}
                            <span>${escapeHtml(title)}</span>
                        </a>` : '';
                    return `<div class="image-card"><img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" loading="lazy" />${sourceHtml}</div>`;
                }).join('');
                const carouselHtml = `\n<div class="image-carousel">${carouselItems}</div>\n`;

                if (textContent.includes(ref.matched_text)) {
                    textContent = textContent.replace(ref.matched_text, carouselHtml);
                }
            }

            if (ref.type === 'webpage' || ref.type === 'webpage_extended') {
                if (textContent.includes(ref.matched_text)) {
                    const index = msg.metadata.content_references.indexOf(ref) + 1;
                    const url = stripChatgptUtm(ref.url || '');
                    if (url) {
                        const citationHtml = renderCitationLink(url, ref.title || '', index);
                        textContent = textContent.replace(ref.matched_text, citationHtml);
                    } else {
                        textContent = textContent.replace(ref.matched_text, '');
                    }
                }
            }

            if (ref.type === 'grouped_webpages') {
                if (textContent.includes(ref.matched_text)) {
                    const items = Array.isArray(ref.items) ? ref.items : [];
                    const url = stripChatgptUtm(items[0]?.url || ref.safe_urls?.[0] || '');
                    const title = items[0]?.title || ref.alt || url;
                    const index = msg.metadata.content_references.indexOf(ref) + 1;
                    if (url) {
                        const citationHtml = renderCitationLink(url, title || '', index);
                        textContent = textContent.replace(ref.matched_text, citationHtml);
                    } else {
                        textContent = textContent.replace(ref.matched_text, '');
                    }
                }
            }

            if (ref.type === 'file') {
                if (textContent.includes(ref.matched_text)) {
                    const fileHtml = `<span title="${escapeHtml(ref.name || 'File')}" style="color: #555; font-size: 0.8em; margin: 0 2px; background: #f0f0f0; padding: 2px 5px; border-radius: 4px; border: 1px solid #ddd;">[File: ${escapeHtml(ref.name || 'Attachment')}]</span>`;
                    textContent = textContent.replace(ref.matched_text, fileHtml);
                }
            }
        }
    }

    if (role === 'tool' && msg.content?.content_type === 'multimodal_text') {
        const parts = msg.content.parts || [];
        for (const part of parts) {
            if (part.asset_pointer) {
                const fileId = part.asset_pointer.replace('sediment://', '');
                const found = allAttachments.find(a => (a.file_id === fileId || a.id === fileId));
                if (found) {
                    const filename = found.saved_as || found.name || 'image.png';
                    const originalName = found.original_name || found.name || 'Generated Image';
                    const relPath = `attachments/${filename}`;
                    return {
                        role: 'assistant',
                        htmlContent: `<div style="text-align:center; margin: 20px 0;"><img src="${relPath}" alt="${escapeHtml(originalName)}" style="max-width: 100%; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" /></div>`,
                        modelSlug: msg.metadata?.model_slug,
                        attachments
                    };
                }
            }
        }
    }

    if (role === 'assistant' && textContent.trim().startsWith('{') && textContent.includes('"referenced_image_ids":')) {
        try {
            const json = JSON.parse(textContent);
            if (json.prompt) {
                const promptHtml = `<div style="font-size: 0.9em; color: #666; font-style: italic;">
                    Generative Prompt: "${escapeHtml(json.prompt)}"
                </div>`;
                return {
                    role: 'assistant',
                    htmlContent: promptHtml,
                    modelSlug: msg.metadata?.model_slug,
                    attachments
                };
            }
        } catch (e) {
        }
    }

    if (msg.content?.content_type === 'thoughts') {
        const thoughts = getThoughtsText(msg.content);
        const html = `
        <details style="margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; padding: 10px;">
            <summary style="cursor: pointer; font-weight: bold; color: #666;">Reasoning Process</summary>
            <div style="margin-top: 10px; color: #444; white-space: pre-wrap; font-family: monospace; font-size: 0.9em;">${escapeHtml(thoughts)}</div>
        </details>`;
        return {
            role,
            htmlContent: html,
            modelSlug: msg.metadata?.model_slug,
            attachments
        };
    }

    if (msg.content?.content_type === 'reasoning_recap') {
        return {
            role,
            htmlContent: `<div style="font-size: 0.85em; color: #888; margin-bottom: 5px;">${escapeHtml(msg.content.content || '')}</div>`,
            modelSlug: msg.metadata?.model_slug,
            attachments
        };
    }

    if (role === 'assistant' && textContent.trim().startsWith('{')) {
        try {
            const json = JSON.parse(textContent);
            if (json.name && json.type === 'code/html' && json.content) {
                const name = String(json.name);
                const content = String(json.content);
                canvasState.byName[name] = content;
                canvasState.lastName = name;
                canvasState.lastContent = content;
                const canvasHtml = renderCanvasBlock(`Canvas: ${name}`, content);
                return {
                    role,
                    htmlContent: canvasHtml,
                    modelSlug: msg.metadata?.model_slug,
                    attachments
                };
            }
            if (json.updates && Array.isArray(json.updates)) {
                const baseName = canvasState.lastName;
                const baseContent = baseName ? canvasState.byName[baseName] : canvasState.lastContent;
                if (baseContent) {
                    const updatedContent = applyCanvasUpdates(baseContent, json.updates);
                    if (baseName) {
                        canvasState.byName[baseName] = updatedContent;
                    }
                    canvasState.lastContent = updatedContent;
                    const title = baseName ? `Canvas Updated: ${baseName}` : 'Canvas Updated';
                    return {
                        role,
                        htmlContent: renderCanvasBlock(title, updatedContent),
                        modelSlug: msg.metadata?.model_slug,
                        attachments
                    };
                }
                const updatesHtml = `
                 <div class="canvas-update-block" style="border: 1px solid #e0e0e0; border-radius: 8px; margin: 10px 0; background: #fafafa;">
                    <div style="padding: 8px 12px; color: #666; font-size: 0.9em;">
                        <strong>Canvas Updated</strong>
                    </div>
                    <div style="padding: 10px; font-family: monospace; font-size: 0.85em; overflow-x: auto;">
                        ${json.updates.map((u: any) => `<div><span style="color: #d32f2f;">- ${escapeHtml(u.pattern || '')}</span><br><span style="color: #388e3c;">+ ${escapeHtml(u.replacement || '')}</span></div>`).join('<hr style="margin: 5px 0; border: 0; border-top: 1px dashed #ccc;">')}
                    </div>
                 </div>`;
                return {
                    role,
                    htmlContent: updatesHtml,
                    modelSlug: msg.metadata?.model_slug,
                    attachments
                };
            }
        } catch (e) {
        }
    }

    const rawHtml = marked.parse(normalizeListIndentation(textContent), { async: false }) as string;
    const htmlContent = sanitizeHtmlContent(rawHtml);

    return {
        role,
        htmlContent,
        modelSlug: msg.metadata?.model_slug,
        attachments
    };
}
