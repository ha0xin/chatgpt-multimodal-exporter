export interface RenderedAttachment {
    url: string;
    name: string;
    isImage: boolean;
}

export interface RenderedMessage {
    role: string;
    htmlContent: string;
    modelSlug?: string;
    attachments: RenderedAttachment[];
}

export interface RenderedNode extends RenderedMessage {
    id: string;
    parentId: string;
    rawText: string;
}

export interface CanvasState {
    lastName?: string;
    lastContent?: string;
    byName: Record<string, string>;
}

export interface ExportedAttachment {
    id?: string;
    file_id?: string;
    pointer?: string;
    name?: string;
    original_name?: string;
    saved_as?: string;
    mime?: string;
    [key: string]: any;
}
