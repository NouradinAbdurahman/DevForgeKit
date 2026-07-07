// A lightweight markdown-ish -> structured block parser for AI chat
// responses (AI Chat Rendering & Response Experience, v2.1.3.1). Hand-
// rolled rather than a dependency - matching this codebase's existing
// precedent of hand-rolling the one wire format actually needed instead
// of pulling in a library (see providers/openaiCompatible.js's own SSE
// parser) - this only needs to cover what an LLM chat response actually
// produces in practice (headers, bold/italic, bullet/numbered lists,
// fenced code blocks, inline code, tables, `<br>`, horizontal rules,
// links), not the full CommonMark spec.
//
// Pure data, zero Ink/React - parseMarkdown() is unit-tested on its own;
// components/markdown.js turns its output into Ink elements.
//
// parseMarkdown(text) -> Block[]
//   { type: "heading", level, segments }
//   { type: "paragraph", segments }
//   { type: "bullet-list", items: Segment[][] }
//   { type: "numbered-list", items: Segment[][] }
//   { type: "code-block", language, code }
//   { type: "table", headers: string[], rows: string[][] }
//   { type: "divider" }
// Segment = { text, bold?, italic?, code?, link? }

// stripHtml(text) - `<br>`/`<br/>`/`<br />` become real newlines (so they
// still separate lines the way the model intended); every other HTML tag
// is removed outright rather than printed literally.
function stripHtml(text) {
    let result = "";
    let i = 0;
    while (i < text.length) {
        if (text[i] !== "<") {
            result += text[i];
            i++;
            continue;
        }
        const rest = text.slice(i);
        const brMatch = /^<br\s*\/?\s*>/i.exec(rest);
        if (brMatch) {
            result += "\n";
            i += brMatch[0].length;
            continue;
        }
        const scriptMatch = /^<script\b[\s\S]*?<\/script\s*>/i.exec(rest);
        if (scriptMatch) {
            i += scriptMatch[0].length;
            continue;
        }
        const tagMatch = /^<[^>]*>/.exec(rest);
        if (tagMatch) {
            i += tagMatch[0].length;
            continue;
        }
        result += "<";
        i++;
    }
    return result;
}

const INLINE_PATTERN = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

// parseInline(text) -> Segment[] - bold/italic/inline-code/link markers
// resolved into styled spans; plain runs kept as-is. Order in the
// alternation matters (bold before single-marker italic) so `**x**`
// never gets misread as two single asterisks.
export function parseInline(rawText) {
    const text = stripHtml(rawText);
    const segments = [];
    let last = 0;
    let match;
    INLINE_PATTERN.lastIndex = 0;
    while ((match = INLINE_PATTERN.exec(text)) !== null) {
        if (match.index > last) segments.push({ text: text.slice(last, match.index) });
        if (match[1]) segments.push({ text: match[2], bold: true });
        else if (match[3]) segments.push({ text: match[4], bold: true });
        else if (match[5]) segments.push({ text: match[6], italic: true });
        else if (match[7]) segments.push({ text: match[8], italic: true });
        else if (match[9]) segments.push({ text: match[10], code: true });
        else if (match[11]) segments.push({ text: `${match[12]} (${match[13]})`, link: true });
        last = INLINE_PATTERN.lastIndex;
    }
    if (last < text.length) segments.push({ text: text.slice(last) });
    return segments.filter((s) => s.text.length > 0);
}

function isHeading(line) {
    return /^#{1,6}\s+/.test(line);
}
function isDivider(line) {
    return /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());
}
function isBullet(line) {
    return /^[-*+]\s+/.test(line);
}
function isNumbered(line) {
    return /^\d+\.\s+/.test(line);
}
function isTableRow(line) {
    return line.includes("|") && line.trim().length > 0;
}
function isTableSeparator(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}
function parseTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// parseMarkdown(text) -> Block[] - see the shape reference above.
export function parseMarkdown(rawText) {
    const text = stripHtml(rawText ?? "");
    const lines = text.split("\n");
    const blocks = [];
    let paraBuf = [];

    function flushParagraph() {
        if (paraBuf.length === 0) return;
        blocks.push({ type: "paragraph", segments: parseInline(paraBuf.join(" ")) });
        paraBuf = [];
    }

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") {
            flushParagraph();
            i++;
            continue;
        }

        if (line.trim().startsWith("```")) {
            flushParagraph();
            const language = line.trim().slice(3).trim() || null;
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // skip the closing fence (or end of text if unterminated)
            blocks.push({ type: "code-block", language, code: codeLines.join("\n") });
            continue;
        }

        if (isHeading(line)) {
            flushParagraph();
            const match = line.match(/^(#{1,6})\s+(.*)$/);
            blocks.push({ type: "heading", level: match[1].length, segments: parseInline(match[2]) });
            i++;
            continue;
        }

        if (isDivider(line)) {
            flushParagraph();
            blocks.push({ type: "divider" });
            i++;
            continue;
        }

        if (isBullet(line)) {
            flushParagraph();
            const items = [];
            while (i < lines.length && isBullet(lines[i])) {
                items.push(parseInline(lines[i].replace(/^[-*+]\s+/, "")));
                i++;
            }
            blocks.push({ type: "bullet-list", items });
            continue;
        }

        if (isNumbered(line)) {
            flushParagraph();
            const items = [];
            while (i < lines.length && isNumbered(lines[i])) {
                items.push(parseInline(lines[i].replace(/^\d+\.\s+/, "")));
                i++;
            }
            blocks.push({ type: "numbered-list", items });
            continue;
        }

        if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            flushParagraph();
            const headers = parseTableRow(line);
            i += 2; // header + separator
            const rows = [];
            while (i < lines.length && isTableRow(lines[i])) {
                rows.push(parseTableRow(lines[i]));
                i++;
            }
            blocks.push({ type: "table", headers, rows });
            continue;
        }

        paraBuf.push(line.trim());
        i++;
    }
    flushParagraph();
    return blocks;
}
