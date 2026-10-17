import { describe, expect, it } from 'vitest';
import { getHighlightHtml } from '../../getHighlightHtml';

// Inline math on the EXPORT path must accept the same spans the editor does.
// Chinese technical writing puts `$…$` directly against CJK text and closes it
// with CJK punctuation; an ASCII-only boundary silently turned every such
// formula into raw text in exported PDFs.

const render = (markdown: string) => getHighlightHtml(markdown, { math: true });
const hasKatex = (markdown: string) => render(markdown).includes('class="katex');

describe('inline math boundaries (export path)', () => {
    it.each([
        'English $i$ text',
        '这是 $i$ 段',
        '这是第$i$段文本',
        '行内 $a+b$。',
        '前后中文$E=mc^2$紧邻',
        '公式$a$，然后$b$。',
    ])('renders KaTeX for %j', (markdown) => {
        expect(hasKatex(markdown)).toBe(true);
    });

    it('keeps currency-like dollar pairs out of math', () => {
        expect(hasKatex('价格 $5 和 $10')).toBe(false);
        expect(hasKatex('from $13B to $24B')).toBe(false);
    });

    it('still finds a real formula after currency-like spans on the same line', () => {
        const html = render('from $13B to $24B and $x+y$');
        expect(html.includes('class="katex"')).toBe(true);
        expect(html.includes('$x+y$')).toBe(false);
        expect(html.includes('$13B')).toBe(true);
    });
});
