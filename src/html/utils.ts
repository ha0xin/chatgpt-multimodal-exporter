export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function escapeHtmlAttr(text: string): string {
    return escapeHtml(text)
        .replace(/\n/g, "&#10;")
        .replace(/\r/g, "&#13;");
}

export function stripChatgptUtm(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('utm_source')) {
            parsed.searchParams.delete('utm_source');
        }
        return parsed.toString();
    } catch (e) {
        return url.replace(/([?&])utm_source=chatgpt\.com(&|$)/, (_match, p1, p2) => {
            if (p2 === '&') return p1;
            return '';
        });
    }
}

export function getHostname(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return url;
    }
}

export function getFaviconUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}/favicon.ico`;
    } catch (e) {
        return '';
    }
}

export function getThoughtsText(content: any): string {
    if (!content) return '';
    if (Array.isArray(content.parts)) {
        return content.parts
            .map((part: any) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
            .filter((part: string) => part.trim() !== '')
            .join('\n');
    }
    if (Array.isArray(content.thoughts)) {
        return content.thoughts
            .map((thought: any) => (typeof thought === 'string' ? thought : thought?.text || thought?.content || ''))
            .filter((thought: string) => thought.trim() !== '')
            .join('\n');
    }
    if (typeof content.thoughts === 'string') {
        return content.thoughts;
    }
    if (typeof content.text === 'string') {
        return content.text;
    }
    return '';
}

export function normalizeListIndentation(text: string): string {
    const lines = text.split('\n');
    let inFence = false;
    const fenceRegex = /^(```|~~~)/;
    const listRegex = /^([ \t\u00a0\u3000]{1,3})(\d+\.[ \t]+|[-*+][ \t]+)/;

    return lines.map(line => {
        const trimmed = line.trimStart();
        if (fenceRegex.test(trimmed)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;
        const match = line.match(listRegex);
        if (!match) return line;
        return line.slice(match[1].length);
    }).join('\n');
}
