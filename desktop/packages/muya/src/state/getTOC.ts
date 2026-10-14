import type { Muya } from '../muya';
import type { TState } from './types';
import { tokenizer, tokensToPlainText } from '../inlineRenderer/lexer';
import { getUniqueId } from '../utils';
import { generateGithubSlug } from '../utils/slug';

export interface ITocItem {
    content: string;
    lvl: number;
    slug: string;
    githubSlug: string;
    /**
     * Top-level state index of the heading. Consumers that must interact with
     * the heading's DOM (scroll-to-outline) use it to materialise the block
     * first — the viewport-bounded mount may not have reached it yet.
     */
    index: number;
}

interface IHeadingShape {
    name: string;
    text?: string;
    meta: { level: number };
}

function isHeadingState(state: TState): state is TState & IHeadingShape {
    return state.name === 'atx-heading' || state.name === 'setext-heading';
}

const slugCache = new WeakMap<object, string>();

/**
 * Stable identity for a heading. The TOC is built from the JSON state (the
 * authoritative list — the DOM only holds the mounted prefix), so slugs are
 * cached against the STATE object; unchanged blocks keep their object
 * reference across ops, so the identity survives edits that do not touch the
 * heading. Pass the same state object `getTOC` enumerated.
 */
export function stableSlug(stateOrBlock: object): string {
    let slug = slugCache.get(stateOrBlock);
    if (slug == null) {
        slug = getUniqueId();
        slugCache.set(stateOrBlock, slug);
    }
    return slug;
}

export function getTOC(muya: Muya): ITocItem[] {
    // Enumerate the state, not the block tree: a viewport-bounded mount keeps
    // only a prefix of the document in the DOM, but the outline must list
    // every heading. Index alignment with the DOM prefix (consumer contract in
    // `tocNavigation`) holds because both sides are in document order.
    const states: readonly TState[] = muya.editor.jsonState.peekState();
    const items: ITocItem[] = [];

    for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (!isHeadingState(state))
            continue;

        const text = state.text ?? '';
        const source = state.name === 'setext-heading'
            ? text.trim()
            : text.replace(/^\s*#{1,6}\s+/, '').trim();

        // Show and slug the heading by its rendered text — inline markdown
        // (`**bold**`, `[label](url)`, images) stripped to what a reader sees —
        // instead of the raw source (#4811). Slugging the same plain text keeps
        // `githubSlug` in step with the anchor id the HTML export injects from
        // `heading.textContent` (state/markdownToHtml.ts).
        const { superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash } = muya.options;
        const content = tokensToPlainText(
            tokenizer(source, {
                hasBeginRules: false,
                options: { superSubScript, footnote, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash },
            }),
        ).trim();

        items.push({
            content,
            lvl: state.meta.level,
            slug: stableSlug(state),
            githubSlug: generateGithubSlug(content),
            index,
        });
    }

    return items;
}
