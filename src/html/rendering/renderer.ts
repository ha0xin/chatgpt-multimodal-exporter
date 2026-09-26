import {
  type ConversationEnvelope,
  type RenderOptions,
  type RenderedMessageHtml,
  type RenderedHtmlPart,
  type AssetResolver,
  type MarkdownPart,
  type MarkdownRenderContext,
} from "./types";
import { linearizeConversation } from "./normalization";
import { createMarkdownRenderer } from "./markdown";
import { escapeHtml } from "./utils";

function extractRecapLabel(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const content = payload as { content?: unknown; text?: unknown; parts?: unknown };
  if (typeof content.content === "string") return content.content;
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(content.parts)) {
    const combined = content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
    return combined;
  }
  return "";
}

/**
 * Render a linearized conversation into HTML strings. Asset parts stay as
 * placeholders so the caller can decide how to fetch and display them.
 */
export function renderConversationToHtml(
  envelope: ConversationEnvelope,
  options: RenderOptions = {},
): RenderedMessageHtml[] {
  const messages = linearizeConversation(envelope, options);
  const markdownRenderer =
    options.markdownToHtml ||
    ((input: MarkdownPart, ctx: MarkdownRenderContext) =>
      createMarkdownRenderer(ctx)(input));
  const resolveAsset: AssetResolver =
    options.assetResolver ||
    ((pointer) => ({
      display: pointer.isCdnPrefixed ? "inline" : "placeholder",
      src: pointer.value,
    }));

  return messages.map((msg) => {
    const renderedParts: RenderedHtmlPart[] = msg.parts.map((part) => {
      switch (part.kind) {
        case "markdown":
          if (msg.authorRole === "user") {
            const escaped = escapeHtml(part.markdown);
            return {
              kind: part.kind,
              html: escaped.replace(/\n/g, "<br/>"),
              source: part,
            };
          }
          return {
            kind: part.kind,
            html: markdownRenderer(part, { safeUrls: [], blockedUrls: [] }),
            source: part,
          };
        case "code":
          return {
            kind: part.kind,
            html: `<pre data-language="${part.language || ""}">${escapeHtml(part.text)}</pre>`,
            source: part,
          };
        case "execution_output":
          return {
            kind: part.kind,
            html: `<pre class="tool-output">${escapeHtml(part.text)}</pre>`,
            source: part,
          };
        case "tool_call":
          return {
            kind: part.kind,
            html: `<div class="tool-call"><strong>${part.name}</strong>${part.text ? `: ${escapeHtml(part.text)}` : ""}</div>`,
            source: part,
          };
        case "asset_pointer": {
          const resolved = resolveAsset(part.pointer);
          const label = `${part.pointer.pointerType}`;
          const html =
            resolved.display === "inline"
              ? `<img src="${resolved.src}" alt="${label}"/>`
              : `<div class="asset-placeholder" data-pointer="${part.pointer.value}">asset: ${label}</div>`;
          return { kind: part.kind, html, source: part };
        }
        case "reasoning_recap": {
          const label = extractRecapLabel(part.payload) || "已思考";
          return {
            kind: part.kind,
            html: `<div class="relative my-1 min-h-6"><div class="relative flex origin-top-left flex-col gap-2 overflow-x-clip rtl:origin-top-right" style="opacity: 1; transform: none;"><div class="relative w-full text-start"><div class="flex w-full flex-row items-start justify-between gap-4 text-start"><button class="flex min-w-0 shrink-1 items-center gap-0.5" type="button"><span class="font-medium w-full"><span class="flex items-center gap-1 truncate text-start align-middle text-token-text-secondary hover:text-token-text-primary dark:hover:text-token-text-primary dark:text-[var(--interactive-label-tertiary-default)]" style="opacity: 1;"><span class="flex min-w-0 items-center gap-1"><span class="min-w-0 truncate">${escapeHtml(
              label,
            )}</span></span><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" data-rtl-flip="" class="icon-xs"><use href="/sprites-core-i9agxugi.svg#b140e7" fill="currentColor"></use></svg></span></span></button></div></div><div class="max-w-[calc(0.8*var(--thread-content-max-width,40rem))]"></div></div></div>`,
            source: part,
          };
        }
        default:
          return {
            kind: part.kind,
            html: `<pre class="unknown-part">${escapeHtml(
              JSON.stringify((part as any).payload ?? part, null, 2),
            )}</pre>`,
            source: part,
          };
      }
    });

    return {
      id: msg.id,
      authorRole: msg.authorRole,
      parts: renderedParts,
      collapsed: msg.collapsed,
      metadata: msg.metadata,
      status: msg.status,
      raw: msg.raw,
    };
  });
}
