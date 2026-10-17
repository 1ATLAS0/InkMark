import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs';

export interface IMathToken {
    type: 'inlineMath' | 'multiplemath';
    raw: string;
    text: string;
    displayMode: boolean;
    mathStyle?: '' | 'gitlab';
}

interface IOptions {
    throwOnError?: boolean;
    useKatexRender?: boolean;
}

// Kept in lockstep with the editor's `inline_math` rule
// (inlineRenderer/rules.ts): a `$` may open a span mid-word, as the editor
// allows, so no whitespace is required before the opener. The previous
// boundary requirement (`\s|^` … `[\s?!.,:]|$`) silently dropped every formula
// written next to CJK text or closed by CJK punctuation — a whole Chinese
// document exported to PDF lost all inline math. The lookahead before the
// opener keeps `$5 … $10` prose out of math.
const inlineStartRule = /\${1,2}(?!\$)/g;
const inlineRule
    = /^(?!\$(?!\$)(?:[^$\\\n]|\\.)*(?:\s\$|\$\d))(\$\$(?!\$)|\$(?=\S))((?:(?!\1)[^\\\n]|\\.)+)\1(?!\1)/;
const blockRule = /^(\${1,2})\n((?:\\[\s\S]|[^\\])+?)\n\1[ \t]*(?:\n|$)/;

const DEFAULT_OPTIONS = {
    throwOnError: false,
    useKatexRender: false,
};

export default function (options: IOptions = {}) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);

    return {
        extensions: [
            inlineKatex(createRenderer(opts, false)),
            blockKatex(createRenderer(opts, true)),
        ],
    };
}

function createRenderer(options: IOptions, newlineAfter: boolean) {
    return (token: IMathToken) => {
        const { useKatexRender, ...otherOpts } = options;
        const { type, text, displayMode, mathStyle } = token;
        if (useKatexRender) {
            return (
                katex.renderToString(text, {
                    ...otherOpts,
                    displayMode,
                }) + (newlineAfter ? '\n' : '')
            );
        }
        else {
            return type === 'inlineMath'
                ? `$${text}$`
                : `<pre class="multiple-math" data-math-style="${mathStyle}">${text}</pre>\n`;
        }
    };
}

function inlineKatex(renderer: (token: IMathToken) => string) {
    return {
        name: 'inlineMath',
        level: 'inline' as const,
        // Every `$` is a candidate, not just the first one: marked stops the
        // surrounding text token here, so returning early on a `$` that turns
        // out not to open a formula would hide every later formula on the
        // line — "from $13B to $24B and $x+y$" must still find `$x+y$`.
        start(src: string) {
            inlineStartRule.lastIndex = 0;
            for (
                let match = inlineStartRule.exec(src);
                match;
                match = inlineStartRule.exec(src)
            ) {
                if (inlineRule.test(src.substring(match.index)))
                    return match.index;
            }
        },
        tokenizer(src: string) {
            const match = src.match(inlineRule);
            if (match) {
                return {
                    type: 'inlineMath',
                    raw: match[0],
                    text: match[2].trim(),
                    displayMode: match[1].length === 2,
                };
            }
        },
        renderer,
    };
}

function blockKatex(renderer: (token: IMathToken) => string) {
    return {
        name: 'multiplemath',
        level: 'block' as const,
        start(src: string) {
            return src.indexOf('\n$');
        },
        tokenizer(src: string) {
            const match = src.match(blockRule);
            if (match) {
                return {
                    type: 'multiplemath',
                    raw: match[0],
                    text: match[2].trim(),
                    displayMode: match[1].length === 2,
                    mathStyle: '',
                };
            }
        },
        renderer,
    };
}
