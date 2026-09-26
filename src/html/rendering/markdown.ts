import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

import { escapeHtml } from './utils';
import type { CitationReference, MarkdownPart, MarkdownRenderContext } from './types';

export function createMarkdownRenderer(
    ctx: MarkdownRenderContext,
): (input: MarkdownPart) => string {
    return (input) => {
        if (ctx.debugRender) {
            const hasTab = /\t/.test(input.markdown);
            const hasBackslash = /\\/.test(input.markdown);
            const hasInlineDelim = /\\\(/.test(input.markdown);
            const hasBlockDelim = /\\\[/.test(input.markdown);
            console.info('[markdown] raw', {
                hasTab,
                hasBackslash,
                hasInlineDelim,
                hasBlockDelim,
                raw: input.markdown,
            });
        }

        const preprocessed = injectCitationRanges(input.markdown, input.citations);
        try {
            const processor = unified()
                .use(remarkParse)
                .use(remarkGfm)
                .use(remarkMath)
                .use(citationPlugin, { citations: input.citations })
                .use(remarkRehype as any, {
                    allowDangerousHtml: true,
                    handlers: {
                        agentCitation: (_state: any, node: any) => ({
                            type: 'element',
                            tagName: node.data.hName,
                            properties: node.data.hProperties,
                            children: node.data.hChildren,
                        }),
                    },
                })
                .use(rehypeKatex as any, { throwOnError: false, strict: 'ignore' })
                .use(rehypeStringify, { allowDangerousHtml: true });
            const html = String(processor.processSync(preprocessed));
            if (ctx.debugRender) console.info('[markdown] html', html);
            return html;
        } catch (err) {
            console.warn('Markdown render failed; retrying without GFM', err);
            try {
                const fallback = unified()
                    .use(remarkParse)
                    .use(remarkMath)
                    .use(citationPlugin, { citations: input.citations })
                    .use(remarkRehype as any, {
                        allowDangerousHtml: true,
                        handlers: {
                            agentCitation: (_state: any, node: any) => ({
                                type: 'element',
                                tagName: node.data.hName,
                                properties: node.data.hProperties,
                                children: node.data.hChildren,
                            }),
                        },
                    })
                    .use(rehypeKatex as any, { throwOnError: false, strict: 'ignore' })
                    .use(rehypeStringify, { allowDangerousHtml: true });
                return String(fallback.processSync(preprocessed));
            } catch {
                return `<pre class="markdown-error">${escapeHtml(input.markdown)}</pre>`;
            }
        }
    };
}

function injectCitationRanges(markdown: string, citations: CitationReference[]): string {
    if (!citations.length) return markdown;
    const replacements: Array<{ start: number; end: number; token: string }> = [];
    const searchOffsets = new Map<string, number>();
    const codePointMap = buildCodePointIndexMap(markdown);

    citations.forEach((ref, idx) => {
        const start = ref.start_idx;
        const end = ref.end_idx;
        if (
            typeof start === 'number' &&
            typeof end === 'number' &&
            start >= 0 &&
            end > start &&
            end <= codePointMap.length - 1
        ) {
            const startUnit = codePointMap[start];
            const endUnit = codePointMap[end];
            const slice = markdown.slice(startUnit, endUnit);
            if (!ref.matched_text || slice === ref.matched_text) {
                replacements.push({ start: startUnit, end: endUnit, token: `{{cite:${idx}}}` });
                return;
            }
        }

        if (ref.matched_text) {
            const needle = ref.matched_text;
            if (!needle.trim()) return;
            const from = searchOffsets.get(needle) ?? 0;
            const foundAt = markdown.indexOf(needle, from);
            if (foundAt !== -1) {
                replacements.push({
                    start: foundAt,
                    end: foundAt + needle.length,
                    token: `{{cite:${idx}}}`,
                });
                searchOffsets.set(needle, foundAt + needle.length);
            }
        }
    });

    if (!replacements.length) return markdown;
    const sorted = replacements.sort((a, b) => b.start - a.start);
    let result = markdown;
    for (const { start, end, token } of sorted) {
        result = `${result.slice(0, start)}${token}${result.slice(end)}`;
    }
    return result;
}

function buildCodePointIndexMap(text: string): number[] {
    const map: number[] = [];
    let unitIndex = 0;
    map.push(unitIndex);
    for (const ch of text) {
        unitIndex += ch.length;
        map.push(unitIndex);
    }
    return map;
}

function citationPlugin(options: { citations?: CitationReference[] }) {
    const citations = options.citations || [];
    const indexByKey = new Map<string, number>();
    const textMatchers: Array<{ text: string; idx: number }> = [];

    citations.forEach((ref, idx) => {
        const key = ref.cite_key || ref.file_id || ref.url || String(idx);
        indexByKey.set(String(key), idx);
        if (ref.matched_text && ref.matched_text.trim()) {
            textMatchers.push({ text: ref.matched_text, idx });
        }
    });

    return (tree: any) => {
        visit(tree as any, 'text', ((node: any, index: number | undefined, parent: any) => {
            if (!parent || typeof node.value !== 'string' || index === undefined) return;

            const fragments: any[] = [{ type: 'text', value: node.value }];
            const regex = /{{(file|web|cite):([^}]+)}}/g;

            let i = 0;
            while (i < fragments.length) {
                const frag = fragments[i];
                if (frag.type !== 'text') {
                    i += 1;
                    continue;
                }

                const matches = [...frag.value.matchAll(regex)];
                if (matches.length === 0) {
                    i += 1;
                    continue;
                }

                const newFrags = [];
                let lastIdx = 0;

                for (const match of matches) {
                    const start = match.index!;
                    const end = start + match[0].length;
                    const kind = match[1];
                    const keyRaw = match[2];

                    if (start > lastIdx) {
                        newFrags.push({ type: 'text', value: frag.value.slice(lastIdx, start) });
                    }

                    if (kind === 'cite') {
                        const idx = Number(keyRaw.trim());
                        const ref = citations[idx];
                        if (Number.isInteger(idx) && ref) {
                            const item = ref.items?.[0];
                            const attribution = item?.attribution;
                            const title = item?.title;
                            const snippet = item?.snippet;
                            const url = item?.url || ref.url;
                            const fallback =
                                ref.label ||
                                ref.matched_text ||
                                ref.cite_key ||
                                ref.url ||
                                ref.file_id ||
                                String(idx + 1);
                            const displayText = (
                                attribution || (typeof fallback === 'string' ? fallback.trim() : fallback)
                            ) || 'Citation';
                            newFrags.push({
                                type: 'agentCitation',
                                data: {
                                    hName: 'span',
                                    hProperties: {
                                        'data-citation-index': idx,
                                        'data-citation-label': displayText,
                                        className: '',
                                        'data-state': 'closed',
                                    },
                                    hChildren: buildCitationPill(displayText, url, title, snippet),
                                },
                            });
                        } else {
                            newFrags.push({ type: 'text', value: match[0] });
                        }
                    } else {
                        const citeKey = keyRaw.trim();
                        const idx = indexByKey.get(citeKey);
                        if (idx !== undefined) {
                            const ref = citations[idx];
                            const label =
                                ref.label || ref.cite_key || ref.url || ref.file_id || String(idx + 1);
                            newFrags.push({
                                type: 'agentCitation',
                                data: {
                                    hName: 'sup',
                                    hProperties: {
                                        'data-citation-index': idx,
                                        'data-citation-label': label,
                                        className: 'agent-citation',
                                    },
                                    hChildren: [{ type: 'text', value: String(idx + 1) }],
                                },
                            });
                        } else {
                            newFrags.push({ type: 'text', value: match[0] });
                        }
                    }

                    lastIdx = end;
                }

                if (lastIdx < frag.value.length) {
                    newFrags.push({ type: 'text', value: frag.value.slice(lastIdx) });
                }

                fragments.splice(i, 1, ...newFrags);
                i += newFrags.length;
            }

            if (textMatchers.length > 0) {
                for (const matcher of textMatchers) {
                    let j = 0;
                    while (j < fragments.length) {
                        const frag = fragments[j];
                        if (frag.type !== 'text') {
                            j += 1;
                            continue;
                        }
                        const txt = frag.value;
                        if (!matcher.text.trim()) {
                            j += 1;
                            continue;
                        }

                        const matchIdx = txt.indexOf(matcher.text);
                        if (matchIdx === -1) {
                            j += 1;
                            continue;
                        }

                        const before = txt.slice(0, matchIdx);
                        const matchVal = txt.slice(matchIdx, matchIdx + matcher.text.length);
                        const after = txt.slice(matchIdx + matcher.text.length);
                        const ref = citations[matcher.idx];
                        const newFrags = [];

                        if (before) newFrags.push({ type: 'text', value: before });
                        newFrags.push({
                            type: 'agentCitation',
                            data: {
                                hName: 'span',
                                hProperties: {
                                    'data-citation-index': matcher.idx,
                                    'data-citation-label': ref.label,
                                    className: 'agent-citation-text',
                                    title: ref.label || 'Citation',
                                },
                                hChildren: [{ type: 'text', value: matchVal }],
                            },
                        });
                        if (after) newFrags.push({ type: 'text', value: after });

                        fragments.splice(j, 1, ...newFrags);
                        j += (before ? 1 : 0) + 1;
                    }
                }
            }

            if (fragments.length > 1 || fragments[0] !== node) {
                parent.children.splice(index, 1, ...fragments);
                return index + fragments.length;
            }
            return undefined;
        }) as any);
    };
}

function buildCitationPill(
    label: string,
    href?: string,
    title?: string,
    snippet?: string,
) {
    const url = href || '#';
    return [
        {
            type: 'element',
            tagName: 'span',
            properties: {
                className: 'citation-pill-wrap',
                'data-testid': 'webpage-citation-pill',
            },
            children: [
                {
                    type: 'element',
                    tagName: 'a',
                    properties: {
                        href: url,
                        target: '_blank',
                        rel: 'noopener',
                        alt: url,
                        'data-citation-pill': 'true',
                        'data-citation-url': url,
                        'data-citation-attribution': label,
                        'data-citation-title': title || '',
                        'data-citation-snippet': snippet || '',
                        className: 'citation-pill',
                    },
                    children: [{ type: 'text', value: label }],
                },
            ],
        },
    ];
}
