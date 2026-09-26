import { pointerToFileId } from '../utils';
import { sanitizeHtmlContent } from './sanitize';
import { createMarkdownRenderer } from './rendering/markdown';
import { normalizeParts } from './rendering/normalization';
import { escapeHtml, getThoughtsText } from './utils';
import type {
    AssetPointer,
    MarkdownPart,
    RenderablePart,
    RenderOptions
} from './rendering/types';
import type {
    CanvasState,
    ExportedAttachment,
    RenderedAttachment,
    RenderedMessage
} from './types';

const markdownRenderer = createMarkdownRenderer({ debugRender: false });
const normalizeOptions: RenderOptions = {
    skipContentTypes: ['tether_browsing_display' as any]
};

function isImageFile(name: string, mime?: string): boolean {
    if (mime && mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function findExportedAttachment(allAttachments: ExportedAttachment[], key: string): ExportedAttachment | undefined {
    return allAttachments.find((att) =>
        att.file_id === key || att.id === key || att.pointer === key
    );
}

function getAttachmentByPointer(pointer: AssetPointer, allAttachments: ExportedAttachment[]): ExportedAttachment | undefined {
    const fileId = pointerToFileId(pointer.value).replace('sediment://', '');
    return (
        findExportedAttachment(allAttachments, fileId) ||
        findExportedAttachment(allAttachments, pointer.value) ||
        findExportedAttachment(allAttachments, pointer.value.replace('sediment://', ''))
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

function renderMarkdownPart(part: MarkdownPart, role: string): string {
    if (role === 'user') {
        return escapeHtml(part.markdown).replace(/\n/g, '<br/>');
    }
    return markdownRenderer(part);
}

function extractRecapLabel(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const content = payload as { content?: unknown; text?: unknown; parts?: unknown };
    if (typeof content.content === 'string') return content.content;
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.parts)) {
        return content.parts
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part) {
                    const text = (part as { text?: unknown }).text;
                    return typeof text === 'string' ? text : '';
                }
                return '';
            })
            .filter(Boolean)
            .join(' ');
    }
    return '';
}

function renderAssetPointer(
    pointer: AssetPointer,
    allAttachments: ExportedAttachment[],
    inlineKeys: Set<string>
): string {
    const found = getAttachmentByPointer(pointer, allAttachments);
    if (found) {
        const key = pointerToFileId(pointer.value).replace('sediment://', '');
        const filename = found.saved_as || found.name || 'attachment';
        const originalName = found.original_name || found.name || filename;
        const relPath = `attachments/${filename}`;
        inlineKeys.add(pointer.value);
        inlineKeys.add(key);
        inlineKeys.add(relPath);

        const mime = found.mime || '';
        if (isImageFile(filename, mime)) {
            return `<img src="${escapeHtml(relPath)}" alt="${escapeHtml(originalName)}" loading="lazy" />`;
        }
        return `<a href="${escapeHtml(relPath)}" download="${escapeHtml(filename)}" class="file-attachment">📎 ${escapeHtml(originalName)}</a>`;
    }

    if (pointer.value.startsWith('data:image/')) {
        return `<img src="${escapeHtml(pointer.value)}" alt="inline image" loading="lazy" />`;
    }

    if (pointer.isCdnPrefixed) {
        return `<img src="${escapeHtml(pointer.value)}" alt="${escapeHtml(pointer.pointerType)}" loading="lazy" />`;
    }

    return `<div class="asset-placeholder" data-pointer="${escapeHtml(pointer.value)}">asset: ${escapeHtml(pointer.pointerType)}</div>`;
}

function renderPart(
    part: RenderablePart,
    role: string,
    allAttachments: ExportedAttachment[],
    inlineKeys: Set<string>
): string {
    switch (part.kind) {
        case 'markdown':
            return renderMarkdownPart(part, role);
        case 'code': {
            const language = part.language ? ` class="language-${escapeHtml(part.language)}"` : '';
            return `<pre><code${language}>${escapeHtml(part.text)}</code></pre>`;
        }
        case 'execution_output':
            return `<pre class="tool-output">${escapeHtml(part.text)}</pre>`;
        case 'tool_call': {
            const title = escapeHtml(part.name || 'tool_call');
            const body = part.text ? `: ${escapeHtml(part.text)}` : '';
            return `<div class="tool-call"><strong>${title}</strong>${body}</div>`;
        }
        case 'asset_pointer':
            return renderAssetPointer(part.pointer, allAttachments, inlineKeys);
        case 'reasoning_recap': {
            const label = extractRecapLabel(part.payload) || '已思考';
            return `<details class="reasoning-recap"><summary>${escapeHtml(label)}</summary></details>`;
        }
        case 'structured_thoughts':
        case 'report':
        case 'canvas':
        case 'sonic_webpage':
        case 'developer_content':
        case 'system_content':
        case 'user_editable_context':
        case 'model_editable_context':
            return `<pre class="unknown-part">${escapeHtml(JSON.stringify(part.payload, null, 2))}</pre>`;
        case 'unknown':
        default:
            return `<pre class="unknown-part">${escapeHtml(JSON.stringify((part as any).payload ?? part, null, 2))}</pre>`;
    }
}

function stringifyPartForRaw(part: RenderablePart, allAttachments: ExportedAttachment[]): string {
    switch (part.kind) {
        case 'markdown':
            return part.markdown;
        case 'code':
        case 'execution_output':
            return part.text;
        case 'tool_call':
            return part.text || part.name;
        case 'asset_pointer': {
            const found = getAttachmentByPointer(part.pointer, allAttachments);
            if (!found) return part.pointer.value;
            const filename = found.saved_as || found.name || 'attachment';
            const name = found.original_name || found.name || filename;
            const relPath = `attachments/${filename}`;
            const mime = found.mime || '';
            if (isImageFile(filename, mime)) return `![${name}](${relPath})`;
            return `[${name}](${relPath})`;
        }
        case 'reasoning_recap':
            return extractRecapLabel(part.payload);
        case 'structured_thoughts':
            return getThoughtsText((part as any).payload);
        default:
            return JSON.stringify((part as any).payload ?? part);
    }
}

export function getRawMessageText(msg: any, allAttachments: ExportedAttachment[]): string {
    if (!msg?.content) return '';
    const parts = normalizeParts(msg, normalizeOptions);
    return parts
        .map((part) => stringifyPartForRaw(part, allAttachments))
        .filter((text) => typeof text === 'string' && text.trim() !== '')
        .join('\n\n');
}

export function renderMessage(msg: any, allAttachments: ExportedAttachment[], _canvasState: CanvasState): RenderedMessage {
    const role = msg.author?.role || 'assistant';
    const normalizedParts = normalizeParts(msg, normalizeOptions);
    const inlineKeys = new Set<string>();
    const textContent = normalizedParts.map((part) => stringifyPartForRaw(part, allAttachments)).join('\n');
    const attachments = collectMessageAttachments(msg, allAttachments, textContent, inlineKeys);

    const htmlContent = normalizedParts
        .map((part) => renderPart(part, role, allAttachments, inlineKeys))
        .filter(Boolean)
        .join('');

    return {
        role,
        htmlContent: sanitizeHtmlContent(htmlContent),
        modelSlug: msg.metadata?.model_slug,
        attachments
    };
}
