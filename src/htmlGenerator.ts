import { Conversation } from './types';
import { buildRenderedNodes } from './html/tree';
import { renderHtmlDocument } from './html/template';
import type { ExportedAttachment } from './html/types';

export type { ExportedAttachment } from './html/types';

export function generateHTML(conversation: Conversation, attachments: ExportedAttachment[]): string {
    const title = conversation.title || 'Conversation';
    const { nodes: renderedNodes, selectedByParent } = buildRenderedNodes(conversation, attachments);
    return renderHtmlDocument(title, renderedNodes, selectedByParent);
}
