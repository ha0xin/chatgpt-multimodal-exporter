export type Role =
  | "user"
  | "assistant"
  | "system"
  | "developer"
  | "tool"
  | string;

export interface ConversationEnvelope {
  mapping: Record<string, MappingNode>;
  current_node: string;
  safe_urls?: string[];
  blocked_urls?: string[];
}

export interface MappingNode {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: MessageNode | null;
}

export interface MessageNode {
  id: string;
  author: { role: Role; name?: string };
  content: MessageContent;
  metadata?: MessageMetadata;
  create_time?: number;
  update_time?: number;
  status?: string;
  recipient?: string;
  channel?: string;
}

// (e.Text = "text"),
// (e.MultimodalText = "multimodal_text"),
// (e.StructuredThoughts = "thoughts"),
// (e.ReasoningRecap = "reasoning_recap"),
// (e.TetherBrowsingCode = "tether_browsing_code"),
// (e.Code = "code"),
// (e.ExecutionOutput = "execution_output"),
// (e.SystemError = "system_error"),
// (e.SystemMessage = "system_message"),
// (e.SystemContent = "system_content"),
// (e.DeveloperContent = "developer_content"),
// (e.TetherBrowsingDisplay = "tether_browsing_display"),
// (e.TetherQuote = "tether_quote"),
// (e.UserEditableContext = "user_editable_context"),
// (e.ModelEditableContext = "model_editable_context"),
// (e.SonicWebpage = "sonic_webpage"),
// (e.ComputerOutput = "computer_output"),
// (e.Error = "error"),
// (e.SuperWidget = "super_widget"),
// (e.CitableCodeOutput = "citable_code_output"),

export type ContentType =
  | "text"
  | "multimodal_text"
  | "thoughts"
  | "structured_thoughts"
  | "reasoning_recap"
  | "code"
  | "execution_output"
  | "system_error"
  | "report"
  | "canvas"
  | "audio"
  | "audio_transcription"
  | "tether_browsing_code"
  | "system_message"
  | "system_content"
  | "developer_content"
  | "tether_browsing_display"
  | "tether_quote"
  | "user_editable_context"
  | "model_editable_context"
  | "sonic_webpage"
  | "computer_output"
  | "error"
  | "super_widget"
  | "citable_code_output";

export interface MessageContent {
  content_type: ContentType;
  parts?: Array<string | MultimodalPart>;
  text?: string; // tool outputs sometimes use a plain text field
}

export interface MultimodalPart {
  text?: string;
  asset_pointer?: string;
  base64_image?: string;
  // catch-all for future rich parts
  [key: string]: unknown;
}

export interface MessageMetadata {
  is_visually_hidden_from_conversation?: boolean;
  content_references?: CitationReference[];
  content_references_by_file?: Record<string, CitationReference[]>;
  n7jupd_crefs?: CitationReference[];
  n7jupd_crefs_by_file?: Record<string, CitationReference[]>;
  async_task_id?: string;
  async_task_type?: string;
  async_task_title?: string;
  async_completion_id?: string;
  is_async_task_result_message?: boolean;
  b1de6e2_rm?: boolean;
  [key: string]: unknown;
}

export interface CitationReference {
  type?: string; // "file", "web", etc.
  cite_key?: string;
  file_id?: string;
  url?: string;
  label?: string;
  alt?: string;
  items?: Array<{
    attribution?: string;
    title?: string;
    url?: string;
    snippet?: string;
  }>;
  matched_text?: string;
  start_idx?: number;
  end_idx?: number;
  [key: string]: unknown;
}

export type RenderablePart =
  | MarkdownPart
  | CodePart
  | ExecutionOutputPart
  | ToolCallPart
  | AssetPointerPart
  | RichPart
  | UnknownPart;

export interface MarkdownPart {
  kind: "markdown";
  markdown: string;
  citations: CitationReference[];
}

export interface CodePart {
  kind: "code";
  language?: string;
  text: string;
  streaming?: boolean;
}

export interface ExecutionOutputPart {
  kind: "execution_output";
  text: string;
  streaming?: boolean;
}

export interface ToolCallPart {
  kind: "tool_call";
  name: string;
  args?: unknown;
  text?: string;
}

export interface AssetPointerPart {
  kind: "asset_pointer";
  pointer: AssetPointer;
}

export interface RichPart {
  kind:
    | "structured_thoughts"
    | "reasoning_recap"
    | "report"
    | "canvas"
    | "sonic_webpage"
    | "developer_content"
    | "system_content"
    | "user_editable_context"
    | "model_editable_context";
  payload: unknown;
}

export interface UnknownPart {
  kind: "unknown";
  payload: unknown;
}

export interface AssetPointer {
  pointerType:
    | "image_asset_pointer"
    | "audio_asset_pointer"
    | "video_asset_pointer"
    | "simple_image_asset_pointer"
    | "arbitrary_asset_pointer"
    | "real_time_user_audio_video_asset_pointer"
    | "unknown";
  value: string;
  isCdnPrefixed: boolean;
}

export interface RenderMessage {
  id: string;
  parentId: string | null;
  authorRole: Role;
  parts: RenderablePart[];
  collapsed?: boolean;
  status?: string;
  metadata?: MessageMetadata;
  raw: MessageNode;
}

export interface RenderedHtmlPart {
  kind: RenderablePart["kind"];
  html: string;
  source: RenderablePart;
}

export interface RenderedMessageHtml {
  id: string;
  authorRole: Role;
  parts: RenderedHtmlPart[];
  collapsed?: boolean;
  metadata?: MessageMetadata;
  status?: string;
  raw: MessageNode;
}

export interface AuthorMatch {
  role?: Role;
  name?: string;
}

export interface RenderOptions {
  markdownToHtml?: (input: MarkdownPart, ctx: MarkdownRenderContext) => string;
  assetResolver?: AssetResolver;
  rootId?: string;
  skipContentTypes?: ContentType[];
  hiddenAuthors?: AuthorMatch[];
  collapsedAuthors?: AuthorMatch[];
  debugRender?: boolean;
  collapsedContentTypes?: ContentType[];
}

export interface MarkdownRenderContext {
  safeUrls?: string[];
  blockedUrls?: string[];
  debugRender?: boolean;
}

export type AssetResolver = (
  pointer: AssetPointer,
) => { display: "inline" | "download" | "placeholder"; src: string };
