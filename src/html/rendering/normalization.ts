import {
  type ConversationEnvelope,
  type MappingNode,
  type MessageNode,
  type RenderMessage,
  type RenderOptions,
  type RenderablePart,
  type CitationReference,
  type ContentType,
  type MessageContent,
  type MultimodalPart,
  type RichPart,
  type AssetPointer,
  type MessageMetadata,
  type AuthorMatch,
} from "./types";
import { DEFAULT_ROOT_ID, CDN_PREFIX } from "./utils";

/**
 * Build a set of node ids that belong to the visible branch ending at current_node.
 */
export function computeVisibleIds(
  mapping: Record<string, MappingNode>,
  currentId: string,
): Set<string> {
  const visible = new Set<string>();
  let cursor: string | null | undefined = currentId;
  while (cursor) {
    visible.add(cursor);
    const parent: string | null | undefined = mapping[cursor]?.parent;
    if (!parent || visible.has(parent)) break;
    cursor = parent;
  }
  // Ensure the synthetic root stays reachable even if missing from the parent chain.
  if (mapping[DEFAULT_ROOT_ID]) visible.add(DEFAULT_ROOT_ID);
  return visible;
}

/**
 * Sort children by create_time then id for stable chronology.
 */
function sortChildren(
  node: MappingNode,
  mapping: Record<string, MappingNode>,
): string[] {
  const children = [...(node.children || [])];
  children.sort((a, b) => {
    const msgA = mapping[a]?.message;
    const msgB = mapping[b]?.message;
    const tsA = msgA?.create_time ?? 0;
    const tsB = msgB?.create_time ?? 0;
    if (tsA !== tsB) return tsA - tsB;
    return a.localeCompare(b);
  });
  return children;
}

function isHidden(meta?: MessageMetadata | null): boolean {
  return Boolean(meta?.is_visually_hidden_from_conversation);
}

function matchesAuthor(
  author: MessageNode["author"],
  matcher?: AuthorMatch,
): boolean {
  if (!matcher) return false;
  if (matcher.role && matcher.role !== author.role) return false;
  if (matcher.name && matcher.name !== author.name) return false;
  return Boolean(matcher.role || matcher.name);
}

function matchesAnyAuthor(
  author: MessageNode["author"],
  filters?: AuthorMatch[],
): boolean {
  if (!filters || filters.length === 0) return false;
  return filters.some((matcher) => matchesAuthor(author, matcher));
}

function describeAuthor(author: MessageNode["author"]): string {
  const role = author?.role ?? "unknown";
  const name = author?.name ? `:${author.name}` : "";
  return `${role}${name}`;
}

function logDecision(
  options: RenderOptions,
  message: MessageNode,
  decision: string,
  extra?: Record<string, unknown>,
): void {
  if (!options.debugRender) return;
  const payload = {
    id: message.id,
    author: describeAuthor(message.author),
    content_type: message.content?.content_type,
    status: message.status,
    ...extra,
  };
  console.info(`[render] ${decision}`, payload);
}

function isCollapsedContentType(
  contentType: ContentType,
  options: RenderOptions,
): boolean {
  return Boolean(options.collapsedContentTypes?.includes(contentType));
}

/**
 * Flatten the mapping DAG into a linear list in display order, keeping only
 * nodes on the visible branch.
 */
export function linearizeConversation(
  envelope: ConversationEnvelope,
  options: RenderOptions = {},
): RenderMessage[] {
  const rootId = options.rootId || DEFAULT_ROOT_ID;
  const visibleIds = computeVisibleIds(envelope.mapping, envelope.current_node);
  const result: RenderMessage[] = [];
  const stack = [rootId];

  while (stack.length) {
    const nodeId = stack.pop()!;
    if (!visibleIds.has(nodeId)) continue;
    const node = envelope.mapping[nodeId];
    if (!node) continue;
    const message = node.message;
    if (message && !isHidden(message.metadata)) {
      if (matchesAnyAuthor(message.author, options.hiddenAuthors)) {
        logDecision(options, message, "skip.hiddenAuthor");
      } else {
        const parts = normalizeParts(message, options);
        if (parts.length === 0) {
          logDecision(options, message, "skip.noParts");
        } else {
          const collapsed =
            matchesAnyAuthor(message.author, options.collapsedAuthors) ||
            isCollapsedContentType(message.content?.content_type, options);
          if (collapsed) {
            logDecision(options, message, "render.collapsed", { parts: parts.length });
          } else {
            logDecision(options, message, "render", { parts: parts.length });
          }
          result.push({
            id: message.id,
            parentId: node.parent ?? null,
            authorRole: message.author?.role,
            parts,
            collapsed,
            status: message.status,
            metadata: message.metadata,
            raw: message,
          });
        }
      }
    } else if (message) {
      logDecision(options, message, "skip.metadataHidden");
    }
    const children = sortChildren(node, envelope.mapping);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const childId = children[i];
      if (visibleIds.has(childId)) stack.push(childId);
    }
  }

  return result;
}

/**
 * Normalize raw message.content into renderable parts.
 */
export function normalizeParts(
  msg: MessageNode,
  options: RenderOptions = {},
): RenderablePart[] {
  const content = msg.content || { content_type: "text" as ContentType };
  const ctype = content.content_type || "text";
  const meta = msg.metadata || {};
  const citations = collectCitations(meta);
  if (options.skipContentTypes?.includes(ctype)) {
    logDecision(options, msg, "skip.contentType", { content_type: ctype });
    return [];
  }

  // Handle Python commentary messages as code blocks
  if (msg.recipient === "python" && msg.channel === "commentary") {
    const text = content.text || stringifyTextParts(content.parts);
    const language = (content as { language?: string }).language || "python";
    return [
      {
        kind: "code",
        language,
        text,
        streaming: msg.status === "in_progress",
      },
    ];
  }

  switch (ctype) {
    case "text":
      return [
        {
          kind: "markdown",
          markdown: stringifyTextParts(content.parts) || content.text || "",
          citations,
        },
      ];
    case "multimodal_text":
      return expandMultimodalParts(content.parts, citations);
    case "code":
      return [
        {
          kind: "code",
          text: stringifyTextParts(content.parts) || content.text || "",
          streaming: msg.status === "in_progress",
        },
      ];
    case "execution_output":
      return [
        {
          kind: "execution_output",
          text: content.text || stringifyTextParts(content.parts),
          streaming: msg.status === "in_progress",
        },
      ];
    case "system_error":
      return [
        {
          kind: "execution_output",
          text: content.text || stringifyTextParts(content.parts),
        },
      ];
    case "structured_thoughts":
    case "thoughts":
    case "reasoning_recap":
    case "report":
    case "canvas":
    case "sonic_webpage":
    case "developer_content":
    case "system_content":
    case "user_editable_context":
    case "model_editable_context":
      return [{ kind: ctype, payload: content } as RichPart];
    case "audio":
    case "audio_transcription":
      return expandAudioParts(content.parts, citations);
    default:
      return [{ kind: "unknown", payload: content }];
  }
}

function stringifyTextParts(parts?: MessageContent["parts"]): string {
  if (!parts || !Array.isArray(parts)) return "";
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object" && "text" in p && typeof p.text === "string")
        return p.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function expandMultimodalParts(
  parts: MessageContent["parts"],
  citations: CitationReference[],
): RenderablePart[] {
  const result: RenderablePart[] = [];
  (parts || []).forEach((p) => {
    if (typeof p === "string" || (p && typeof p === "object" && "text" in p)) {
      result.push({
        kind: "markdown",
        markdown: typeof p === "string" ? p : (p as MultimodalPart).text || "",
        citations,
      });
    } else if (p && typeof p === "object" && "asset_pointer" in p) {
      const pointerVal = String((p as MultimodalPart).asset_pointer || "");
      result.push({
        kind: "asset_pointer",
        pointer: normalizeAssetPointer(pointerVal),
      });
    } else if (p && typeof p === "object" && "base64_image" in p) {
      result.push({
        kind: "asset_pointer",
        pointer: {
          pointerType: "simple_image_asset_pointer",
          value: String((p as MultimodalPart).base64_image),
          isCdnPrefixed: false,
        },
      });
    }
  });
  return result;
}

function expandAudioParts(
  parts: MessageContent["parts"],
  citations: CitationReference[],
): RenderablePart[] {
  const result: RenderablePart[] = [];
  (parts || []).forEach((p) => {
    if (typeof p === "string" || (p && typeof p === "object" && "text" in p)) {
      result.push({
        kind: "markdown",
        markdown: typeof p === "string" ? p : (p as MultimodalPart).text || "",
        citations,
      });
    } else if (p && typeof p === "object" && "asset_pointer" in p) {
      const pointerVal = String((p as MultimodalPart).asset_pointer || "");
      result.push({
        kind: "asset_pointer",
        pointer: normalizeAssetPointer(pointerVal),
      });
    }
  });
  return result;
}

function normalizeAssetPointer(value: string): AssetPointer {
  const pointerType = value.includes("audio") ? "audio_asset_pointer" : value.includes("video")
      ? "video_asset_pointer"
      : value.includes("image")
        ? "image_asset_pointer"
        : "arbitrary_asset_pointer";
  return {
    pointerType,
    value,
    isCdnPrefixed: value.startsWith(CDN_PREFIX),
  };
}

export function collectCitations(meta: MessageMetadata = {}): CitationReference[] {
  const refs: CitationReference[] = [];
  refs.push(...(meta.content_references || []));
  Object.values(meta.content_references_by_file || {}).forEach((group) =>
    refs.push(...group),
  );
  const n7 =
    meta.n7jupd_crefs ||
    meta.n7jupd_crefs_by_file ||
    ([] as CitationReference[] | Record<string, CitationReference[]>);
  if (Array.isArray(n7)) refs.push(...n7);
  else if (typeof n7 === "object") {
    Object.values(n7).forEach((group) => refs.push(...group));
  }
  return refs;
}
