//! The pure classification core: one comment in, one verdict out.
//!
//! No I/O, no clock, no randomness, no branches — the decision is a fold over
//! ordered rule tables (CONST-P1, CONST-P2).

use crate::comment::{
    Comment, CommentType, Justification, PositionRole, RestateEvidence, UnnecessaryKind, Verdict,
};

/// A classification rule: the reason it assigns and the predicate that
/// recognises it. Predicates receive the comment's trimmed, lowercased text as
/// their first argument and the full [`Comment`] for fields the text cannot
/// carry (line number, comment type).
struct Rule<R> {
    reason: R,
    matches: fn(&str, &Comment) -> bool,
}

/// Rules that justify keeping a comment, in priority order.
static JUSTIFIED: &[Rule<Justification>] = &[
    Rule {
        reason: Justification::Shebang,
        matches: is_shebang,
    },
    Rule {
        reason: Justification::LicenseHeader,
        matches: is_license,
    },
    Rule {
        reason: Justification::GeneratedFile,
        matches: is_generated_file,
    },
    Rule {
        reason: Justification::LinterDirective,
        matches: is_directive,
    },
    Rule {
        reason: Justification::BddStep,
        matches: is_bdd,
    },
    Rule {
        reason: Justification::PublicApiDoc,
        matches: is_public_api_doc,
    },
    Rule {
        reason: Justification::Attribution,
        matches: is_attribution,
    },
    Rule {
        reason: Justification::NonObviousIntent,
        matches: is_non_obvious_intent,
    },
];

/// Rules that mark a comment unnecessary, in priority order.
static UNNECESSARY: &[Rule<UnnecessaryKind>] = &[
    Rule {
        reason: UnnecessaryKind::AgentMemo,
        matches: is_agent_memo,
    },
    Rule {
        reason: UnnecessaryKind::CommentedOutCode,
        matches: is_commented_out_code,
    },
    Rule {
        reason: UnnecessaryKind::VacuousTodo,
        matches: is_vacuous_todo,
    },
];

/// Classify a comment: the first matching justification wins; failing that,
/// the first matching unnecessary-kind; failing that, the comment merely
/// restates the code and is unnecessary.
#[must_use]
pub fn classify(comment: &Comment) -> Verdict {
    let text = comment.text.trim().to_ascii_lowercase();
    let verdict = JUSTIFIED
        .iter()
        .find(|rule| (rule.matches)(text.as_str(), comment))
        .map(|rule| Verdict::Justified {
            reason: rule.reason,
        })
        .or_else(|| {
            UNNECESSARY
                .iter()
                .find(|rule| (rule.matches)(text.as_str(), comment))
                .map(|rule| Verdict::Unnecessary {
                    reason: rule.reason.clone(),
                })
        })
        .unwrap_or_else(|| {
            // The context-aware restatement path is primary; the terminal
            // rule (empty evidence) is retained for zero-overlap filler.
            Verdict::Unnecessary {
                reason: UnnecessaryKind::RestatesCode {
                    evidence: restate_evidence(comment),
                },
            }
        });
    // Conservative downgrade: when a comment's structural context is unreliable
    // (Edit/MultiEdit fragment edge) the catch-all RestatesCode path is too
    // aggressive. Use a high-confidence justification instead — PreferDontConvict.
    if is_unreliable_fallback(&verdict) && comment.context.as_ref().is_some_and(|c| c.unreliable) {
        return Verdict::Justified {
            reason: Justification::NonObviousIntent,
        };
    }
    verdict
}

const fn is_unreliable_fallback(verdict: &Verdict) -> bool {
    matches!(
        verdict,
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode { .. }
        }
    )
}

/// True when the comment's content-bearing vocabulary is mostly contained in
/// the adjacent code's: at least half of the comment's content tokens also
/// appear among the adjacent code's content tokens.
///
/// Lexical containment only — the operator table is an evidence *addition*
/// ([`restate_evidence`]), not part of the doc-contract revocation check.
#[must_use]
pub fn restates_adjacent(comment: &Comment) -> bool {
    lexical_containment(comment).is_some_and(|c| c >= RESTATE_CONTAINMENT)
}

/// The overlap threshold: half of the comment's unique content tokens must
/// also appear in the adjacent code before the restatement claim is made.
const RESTATE_CONTAINMENT: f64 = 0.5;

/// The deterministic synonym/operator table (KTD3): a comment verb whose
/// action the adjacent code expresses with an operator or keyword.
const OPERATOR_TABLE: &[(&str, &[&str])] = &[
    ("increment", &["+=", "++"]),
    ("increments", &["+=", "++"]),
    ("incrementing", &["+=", "++"]),
    ("decrement", &["-=", "--"]),
    ("decrements", &["-=", "--"]),
    ("decrementing", &["-=", "--"]),
    ("assign", &["=", ":="]),
    ("assigns", &["=", ":="]),
    ("assigned", &["=", ":="]),
    ("return", &["return"]),
    ("returns", &["return"]),
    ("returning", &["return"]),
    ("add", &["+"]),
    ("adds", &["+"]),
    ("adding", &["+"]),
    ("subtract", &["-"]),
    ("subtracts", &["-"]),
    ("subtracting", &["-"]),
    ("multiply", &["*"]),
    ("multiplies", &["*"]),
    ("multiplying", &["*"]),
    ("divide", &["/"]),
    ("divides", &["/"]),
    ("dividing", &["/"]),
    ("double", &["* 2", " *2"]),
    ("doubles", &["* 2", " *2"]),
    ("halve", &["/ 2", " /2"]),
    ("halves", &["/ 2", " /2"]),
];

/// True when `adjacent` (lowercased) contains the operator `op`.
///
/// Word-like operators (`return`) match as whole tokens so `add` in
/// `address` cannot fire; symbolic operators (`+=`, `+`, `*`) match as
/// substrings, which a parse would confirm in every realistic spelling.
fn code_contains_operator(
    adjacent: &str,
    adjacent_tokens: &std::collections::HashSet<String>,
    op: &str,
) -> bool {
    if op.chars().all(|c| c.is_alphanumeric() || c == '_') {
        adjacent_tokens.contains(op)
    } else {
        adjacent.contains(op)
    }
}

/// The evidence that `comment` restates its adjacent code (U3, KTD3): the
/// overlapping tokens cited, and any verb→operator table matches.
///
/// Never called on unreliable context (Edit fragments); the caller falls back
/// to the terminal text-only rule via empty evidence.
#[must_use]
pub fn restate_evidence(comment: &Comment) -> RestateEvidence {
    let Some(adjacent) = comment
        .context
        .as_ref()
        .filter(|c| !c.unreliable)
        .and_then(|c| c.adjacent_code.as_ref())
    else {
        return RestateEvidence::default();
    };
    let comment_tokens = ordered_content_tokens(&comment.text);
    if comment_tokens.is_empty() {
        return RestateEvidence::default();
    }
    let adjacent_tokens = content_tokens(adjacent);
    let adjacent_lower = adjacent.to_ascii_lowercase();

    let mut lexical = Vec::new();
    let mut operator = Vec::new();
    for token in &comment_tokens {
        if adjacent_tokens.contains(token) {
            lexical.push(token.clone());
        }
        if let Some((_, ops)) = OPERATOR_TABLE.iter().find(|(verb, _)| verb == token) {
            if let Some(op) = ops
                .iter()
                .find(|op| code_contains_operator(&adjacent_lower, &adjacent_tokens, op))
            {
                operator.push((token.clone(), (*op).to_owned()));
            }
        }
    }

    let containment = f64::from(u32::try_from(lexical.len()).unwrap_or(0))
        / f64::from(u32::try_from(comment_tokens.len()).unwrap_or(1));
    let evidence = RestateEvidence { lexical, operator };
    if containment >= RESTATE_CONTAINMENT || !evidence.operator.is_empty() {
        evidence
    } else {
        RestateEvidence::default()
    }
}

/// The lexical containment of the comment's vocabulary in its adjacent code,
/// or `None` when the context is absent or carries no adjacent code.
fn lexical_containment(comment: &Comment) -> Option<f64> {
    let adjacent = comment
        .context
        .as_ref()
        .and_then(|c| c.adjacent_code.as_ref())?;
    let comment_tokens = ordered_content_tokens(&comment.text);
    if comment_tokens.is_empty() {
        return None;
    }
    let adjacent_tokens = content_tokens(adjacent);
    let intersection = comment_tokens
        .iter()
        .filter(|t| adjacent_tokens.contains(*t))
        .count();
    Some(
        f64::from(u32::try_from(intersection).unwrap_or(0))
            / f64::from(u32::try_from(comment_tokens.len()).unwrap_or(1)),
    )
}

/// English stop-words stripped from content tokens. Compiled separately to
/// keep [`content_tokens`] readable.
const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "of", "to", "in", "is", "it", "for", "on", "and", "or", "with", "this",
    "that", "these", "those", "as", "by", "be", "are", "was", "but", "not", "no",
];

/// The content-bearing tokens of `text` in order of first appearance.
fn ordered_content_tokens(text: &str) -> Vec<String> {
    let stripped = strip_comment_marker(text).trim().to_ascii_lowercase();
    let mut seen = std::collections::HashSet::new();
    stripped
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty() && !STOP_WORDS.contains(s))
        .filter(|s| seen.insert((*s).to_owned()))
        .map(str::to_owned)
        .collect()
}

/// The set of content-bearing tokens in `text`. Splits on whitespace and
/// punctuation, lower-cases, strips comment markers and English stop-words.
/// Returns owned strings so callers can decide lifetime.
#[must_use]
pub fn content_tokens(text: &str) -> std::collections::HashSet<String> {
    ordered_content_tokens(text).into_iter().collect()
}

const COMMENT_MARKERS: &[&str] = &["//", "/*", "#", "--", "*"];

/// Strip one leading comment marker and trim leading whitespace.
fn strip_comment_marker(text: &str) -> &str {
    COMMENT_MARKERS
        .iter()
        .find_map(|marker| text.strip_prefix(marker))
        .map_or(text, str::trim_start)
}

/// Strip one leading comment marker and any leading whitespace after it.
///
/// `strip_comment_marker` alone trims only when a marker matched; this also
/// drops blank margin when the text had no marker.
fn stripped_after_marker(text: &str) -> &str {
    strip_comment_marker(text).trim_start()
}

fn any_starts(text: &str, list: &[&str]) -> bool {
    list.iter().any(|p| text.starts_with(p))
}

fn any_contains(text: &str, list: &[&str]) -> bool {
    list.iter().any(|m| text.contains(m))
}

fn any_starts_after_strip(text: &str, list: &[&str]) -> bool {
    let s = stripped_after_marker(text);
    let s = s.strip_prefix('@').unwrap_or(s);
    any_starts(s, list)
}

fn is_shebang(text: &str, _comment: &Comment) -> bool {
    text.starts_with("#!")
}

fn is_license(text: &str, _comment: &Comment) -> bool {
    any_contains(text, LICENSE_MARKERS)
}

fn is_generated_file(text: &str, _comment: &Comment) -> bool {
    any_contains(text, GENERATED_MARKERS)
}

fn is_directive(text: &str, _comment: &Comment) -> bool {
    any_starts_after_strip(text, DIRECTIVE_PREFIXES)
}

fn is_bdd(text: &str, _comment: &Comment) -> bool {
    let s = strip_comment_marker(text).trim();
    BDD_KEYWORDS.contains(&s)
}

/// A docstring documents a public contract when it carries contract markup
/// (`@param`, `Args:`, `Returns:`, …); a line or block comment does the same
/// when contract markup *leads* the comment at a contract position (U4).
///
/// Structural context can only *narrow* that judgement, never widen it — the
/// corpus treats a bare summary line (`"""Fetch the user."""`) as a
/// restatement, so position alone must not justify a comment. When context is
/// available the markup must additionally be positioned as a contract:
/// attached to a declaration, not trailing a statement; and a docstring must
/// not merely echo the declaration it documents (U3). A line/block comment
/// whose lone job is the contract tag (`# Returns: …`) is not revoked for
/// echoing — the tag is the contract.
fn is_public_api_doc(text: &str, comment: &Comment) -> bool {
    let markup = match comment.comment_type {
        CommentType::Docstring => any_contains(text, DOC_MARKUP),
        // Non-docstrings need the markup at the start, so prose that happens
        // to mention `@param` mid-sentence is never promoted to a contract.
        CommentType::Line | CommentType::Block => leads_with_contract_markup(text),
    };
    if !markup {
        return false;
    }
    // Text-only / unreliable path: only docstrings are promoted by markup
    // alone; a line comment without trustworthy position documents nothing.
    let Some(ctx) = comment.context.as_ref().filter(|c| !c.unreliable) else {
        return comment.comment_type == CommentType::Docstring;
    };
    let positioned_as_contract = match ctx.position {
        // Python-style: the docstring lives at the head of the body it documents.
        PositionRole::DocstringHead => true,
        // Brace-style: the doc comment precedes the declaration it documents.
        PositionRole::Leading => ctx.annotates_declaration,
        // A doc-shaped comment after or beside code documents nothing.
        PositionRole::Trailing | PositionRole::Inline => false,
    };
    if !positioned_as_contract {
        return false;
    }
    match comment.comment_type {
        CommentType::Docstring => !restates_adjacent(comment),
        CommentType::Line | CommentType::Block => true,
    }
}

/// Contract markup that must *lead* a non-docstring comment (after its marker
/// and margin) for it to be read as interface documentation. Attribution-only
/// tags (`@author`, `@see`, `ref:`, …) are excluded — they justify via their
/// own rule and must not masquerade as contracts.
const CONTRACT_LEAD_MARKUP: &[&str] = &[
    "@param",
    "@returns",
    "@return",
    "@throws",
    "@raises",
    "@exception",
    "@example",
    "@deprecated",
    "@since",
    "@type",
    "@typedef",
    "@property",
    "# examples",
    "# panics",
    "# errors",
    "# safety",
    ":param",
    ":return:",
    ":rtype:",
    ":raises:",
    ":type",
    "args:",
    "returns:",
    "raises:",
    "yields:",
    "attributes:",
    "@brief",
    "@details",
    "@note",
    "@warning",
];

/// True when the first content of the comment (after stripping the marker) is
/// a contract tag.
fn leads_with_contract_markup(text: &str) -> bool {
    let s = stripped_after_marker(text);
    CONTRACT_LEAD_MARKUP.iter().any(|m| s.starts_with(m))
}

fn is_non_obvious_intent(text: &str, _comment: &Comment) -> bool {
    any_contains(text, INTENT_MARKERS)
}

fn is_attribution(text: &str, _comment: &Comment) -> bool {
    any_contains(text, ATTRIBUTION_MARKERS)
}

fn is_agent_memo(text: &str, _comment: &Comment) -> bool {
    any_starts(stripped_after_marker(text), AGENT_MEMO_PREFIXES)
}

fn is_commented_out_code(text: &str, _comment: &Comment) -> bool {
    let s = stripped_after_marker(text);
    any_starts(s, CODE_KEYWORDS) || any_contains(s, CODE_PUNCTUATION) || looks_like_assignment(s)
}

/// True when the text is shaped like an assignment statement: a bare
/// identifier path, then ` = `, then a value — `x = x + 1`, `cfg.retries = 3`.
///
/// Deliberately narrow: the left side must be a single path with no spaces, so
/// prose that happens to contain an equals sign (`set x = 1 because …`) is not
/// mistaken for code.
fn looks_like_assignment(s: &str) -> bool {
    let Some((lhs, rhs)) = s.split_once(" = ") else {
        return false;
    };
    if rhs.trim().is_empty() {
        return false;
    }
    let lhs = lhs.trim();
    let path_char = |c: char| c.is_alphanumeric() || matches!(c, '_' | '.' | '[' | ']' | '*' | '&');
    let starts_path = lhs
        .chars()
        .next()
        .is_some_and(|c| c.is_alphabetic() || matches!(c, '_' | '*' | '&'));
    !lhs.is_empty() && starts_path && lhs.chars().all(path_char)
}

fn is_vacuous_todo(text: &str, _comment: &Comment) -> bool {
    any_starts(stripped_after_marker(text), TODO_PREFIXES)
}

const LICENSE_MARKERS: &[&str] = &[
    "spdx-license-identifier",
    "copyright",
    "licensed under",
    "permission is hereby granted",
    "all rights reserved",
    "redistribution and use",
    "gnu general public license",
    "apache license",
    "mit license",
    "bsd license",
    "mozilla public license",
];
const GENERATED_MARKERS: &[&str] = &[
    "do not edit",
    "auto-generated",
    "autogenerated",
    "code generated",
    "generated by",
];

const DIRECTIVE_PREFIXES: &[&str] = &[
    "noqa",
    "type:",
    "pyright:",
    "ruff:",
    "mypy:",
    "pylint:",
    "flake8:",
    "pyre:",
    "pytype:",
    "eslint-disable",
    "eslint-ignore",
    "prettier-ignore",
    "ts-ignore",
    "ts-expect-error",
    "ts-nocheck",
    "clippy:",
    "golangci-lint:",
    "nolint",
    "lint:",
    "fmt:",
    "shellcheck",
    "cspell",
    "spell-checker",
    "istanbul",
    "gosec",
    "staticcheck",
    "tslint",
    "stylelint",
    "biome",
    "sonar",
    "codacy",
    "noinspection",
    "pragma:",
    "yaml-language-server",
];

const BDD_KEYWORDS: &[&str] = &[
    "given",
    "when",
    "then",
    "arrange",
    "act",
    "assert",
    "when & then",
    "when&then",
];

const DOC_MARKUP: &[&str] = &[
    "@param",
    "@returns",
    "@return",
    "@throws",
    "@raises",
    "@exception",
    "@example",
    "@see",
    "@author",
    "@deprecated",
    "@since",
    "@type",
    "@typedef",
    "@property",
    "# examples",
    "# panics",
    "# errors",
    "# safety",
    ":param",
    ":return:",
    ":rtype:",
    ":raises:",
    ":type",
    "args:",
    "returns:",
    "raises:",
    "yields:",
    "attributes:",
    "@brief",
    "@details",
];

const INTENT_MARKERS: &[&str] = &[
    "why",
    "because",
    "workaround",
    "note:",
    "important:",
    "warning:",
    "caution:",
    "fixes #",
    "issue #",
    "bug #",
    "see http",
    "https://",
    "http://",
    "to avoid",
    "to prevent",
    "must not",
    "should not",
    "must be",
    "deprecated:",
    "algorithm",
    "regex",
    "security",
    "thread-safety",
    "thread safety",
    "1-based",
    "0-based",
    "@link",
];

const ATTRIBUTION_MARKERS: &[&str] = &[
    "@author",
    "@copyright",
    "adapted from",
    "based on",
    "ported from",
    "credit",
    "@see",
    "@link",
    "ref:",
    "source:",
];

const AGENT_MEMO_PREFIXES: &[&str] = &[
    "changed",
    "modified",
    "updated",
    "refactor",
    "moved",
    "renamed",
    "replaced",
    "removed",
    "deleted",
    "added",
    "implemented",
    "created",
    "fixed",
    "this implements",
    "this adds",
    "this removes",
    "this changes",
    "this fixes",
    "here we",
    "now we",
    "now this",
    "now it",
    "previously",
    "before this",
    "after this",
    "was changed",
    "implementation of",
    "implementation note",
    "converted",
    "migrated",
    "switched",
];

const TODO_PREFIXES: &[&str] = &["todo", "fixme"];

const CODE_KEYWORDS: &[&str] = &[
    "if ", "else ", "for ", "while ", "return ", "var ", "let ", "const ", "func ", "fn ",
    "class ", "def ", "import ", "from ", "print", "fmt.", "console.", "package ", "use ", "pub ",
    "throw ", "raise ", "echo ", "require(", "select ", "insert ", "update ", "delete ", "typeof ",
    "async ", "await ", "std::", "self.", "this.",
];

const CODE_PUNCTUATION: &[&str] = &[";", "{", "}", "=>", ":=", "++", "--", "=="];
