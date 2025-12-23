import { Conversation } from '../types';
import { getThoughtsText } from './utils';
import { getRawMessageText, renderMessage } from './messages';
import type { CanvasState, ExportedAttachment, RenderedNode } from './types';

export const VIRTUAL_ROOT_ID = '__root__';

function cloneCanvasState(state: CanvasState): CanvasState {
    return {
        lastName: state.lastName,
        lastContent: state.lastContent,
        byName: { ...state.byName }
    };
}

function hasRenderableContent(msg: any): boolean {
    const content = msg.content;
    const contentType = content?.content_type;
    if (contentType === 'text') {
        if (Array.isArray(content?.parts)) {
            return content.parts.some((part: any) =>
                typeof part === 'string' ? part.trim() !== '' : Boolean(part)
            );
        }
        if (typeof content?.text === 'string') {
            return content.text.trim() !== '';
        }
        return false;
    }
    if (contentType === 'thoughts') {
        return getThoughtsText(content).trim() !== '';
    }
    if (contentType === 'reasoning_recap') {
        return typeof content?.content === 'string' && content.content.trim() !== '';
    }
    if (contentType === 'multimodal_text') {
        return Array.isArray(content?.parts) && content.parts.length > 0;
    }
    return Boolean(content);
}

function shouldRenderMessage(msg: any): boolean {
    if (!msg) return false;
    const isHidden = msg.metadata?.is_visually_hidden_from_conversation;
    if (isHidden) return false;
    const isLoadingMessage = msg.metadata?.is_loading_message === true;
    if (isLoadingMessage) return false;
    if (!hasRenderableContent(msg)) return false;
    if (!['user', 'assistant', 'tool'].includes(msg.author.role)) return false;
    if (msg.author.role === 'tool') {
        const toolName = msg.author.name || '';
        const isInternalTool =
            toolName === 'file_search' ||
            toolName.startsWith('canmore.') ||
            toolName.startsWith('research_kickoff_tool.') ||
            Boolean(msg.metadata?.canvas);
        if (isInternalTool) return false;
    }
    if (msg.author.role === 'assistant' && typeof msg.recipient === 'string') {
        if (msg.recipient.startsWith('research_kickoff_tool.')) return false;
    }
    if (msg.content?.content_type === 'model_editable_context') return false;
    return true;
}

function extractRenderablePathIds(conv: Conversation, renderableIds: Set<string>): string[] {
    const ids: string[] = [];
    let currentId = conv.current_node;
    while (currentId) {
        const node = conv.mapping[currentId];
        if (!node) break;
        if (renderableIds.has(currentId)) ids.unshift(currentId);
        if (!node.parent) break;
        currentId = node.parent;
    }
    return ids;
}

export function buildRenderedNodes(
    conv: Conversation,
    attachments: ExportedAttachment[]
): { nodes: RenderedNode[]; selectedByParent: Record<string, string> } {
    const mapping = conv.mapping || {};
    const renderableIds = new Set<string>();
    for (const node of Object.values(mapping)) {
        if (node?.message && shouldRenderMessage(node.message)) {
            renderableIds.add(node.id);
        }
    }

    const visibleParentById: Record<string, string> = {};
    for (const id of renderableIds) {
        let parentId = mapping[id]?.parent || null;
        while (parentId && !renderableIds.has(parentId)) {
            parentId = mapping[parentId]?.parent || null;
        }
        visibleParentById[id] = parentId || VIRTUAL_ROOT_ID;
    }

    const renderedNodes: RenderedNode[] = [];
    const rootIds = Object.values(mapping).filter((node) => !node.parent).map((node) => node.id);

    const traverse = (nodeId: string, canvasState: CanvasState) => {
        const node = mapping[nodeId];
        if (!node) return;
        const msg = node.message;
        let nextState = canvasState;
        if (msg && renderableIds.has(nodeId)) {
            const localState = cloneCanvasState(canvasState);
            const rendered = renderMessage(msg, attachments, localState);
            renderedNodes.push({
                id: nodeId,
                parentId: visibleParentById[nodeId],
                role: rendered.role,
                htmlContent: rendered.htmlContent,
                modelSlug: rendered.modelSlug,
                attachments: rendered.attachments,
                rawText: getRawMessageText(msg, attachments)
            });
            nextState = localState;
        }
        for (const childId of node.children || []) {
            traverse(childId, cloneCanvasState(nextState));
        }
    };

    rootIds.forEach((rootId) => {
        traverse(rootId, { byName: {} });
    });

    const selectedByParent: Record<string, string> = {};
    const pathIds = extractRenderablePathIds(conv, renderableIds);
    for (const id of pathIds) {
        const parentId = visibleParentById[id] || VIRTUAL_ROOT_ID;
        selectedByParent[parentId] = id;
    }

    return { nodes: renderedNodes, selectedByParent };
}
