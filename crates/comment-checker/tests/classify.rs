//! Tests for the pure classification core.
//!
//! Two layers, per the testing trophy (CONST-T1):
//! - **Property tests** pin the invariants: totality (no panic on any input)
//!   and "a justified category is never flagged".
//! - **Contract cases** pin the observable flag/allow decision for each
//!   category, in both directions, so a rule change or removal fails a test.

use claude_code_comment_checker::classify::classify;
use claude_code_comment_checker::{
    Comment, CommentContext, CommentType, Justification, PositionRole, RestateEvidence, Scope,
    UnnecessaryKind, Verdict,
};
use proptest::prelude::*;
use proptest::strategy::Strategy;

fn arbitrary_comment() -> impl Strategy<Value = Comment> {
    (
        any::<String>(),
        any::<usize>(),
        prop_oneof![
            Just(CommentType::Line),
            Just(CommentType::Block),
            Just(CommentType::Docstring),
        ],
    )
        .prop_map(|(text, line, comment_type)| Comment::new(text, line, comment_type))
}

fn line(text: impl Into<String>) -> Comment {
    Comment::new(text, 1, CommentType::Line)
}

fn docstring(text: impl Into<String>) -> Comment {
    Comment::new(text, 1, CommentType::Docstring)
}

proptest! {
    /// `classify` is a total function: it never panics on any comment,
    /// whatever the text, line number, or syntactic form.
    #[test]
    fn classify_is_total(comment in arbitrary_comment()) {
        let _ = classify(&comment);
    }

    /// A shebang is never flagged, whatever follows the `#!`.
    #[test]
    fn shebang_is_never_flagged(tail in any::<String>()) {
        let comment = line(format!("#!{tail}"));
        assert_eq!(
            classify(&comment),
            Verdict::Justified { reason: Justification::Shebang }
        );
    }

    /// Text carrying an SPDX marker is never flagged.
    #[test]
    fn license_is_never_flagged(prefix in any::<String>(), suffix in any::<String>()) {
        let comment = line(format!("{prefix} SPDX-License-Identifier {suffix}"));
        assert!(matches!(classify(&comment), Verdict::Justified { .. }));
    }

    /// A linter directive is never flagged, whatever follows the marker.
    #[test]
    fn directive_is_never_flagged(tail in any::<String>()) {
        let comment = line(format!("# noqa{tail}"));
        assert_eq!(
            classify(&comment),
            Verdict::Justified { reason: Justification::LinterDirective }
        );
    }

    /// A BDD step keyword is never flagged.
    #[test]
    fn bdd_step_is_never_flagged(keyword in prop_oneof![
        Just("given"), Just("when"), Just("then"),
        Just("arrange"), Just("act"), Just("assert"),
    ]) {
        let comment = line(format!("# {keyword}"));
        assert_eq!(
            classify(&comment),
            Verdict::Justified { reason: Justification::BddStep }
        );
    }
}

// Contract cases — each names the misclassification bug it catches.

#[test]
fn plain_comment_is_unnecessary() {
    // Bug: a comment that merely restates the code is flagged as justified,
    // or mislabelled as a specific kind.
    assert_eq!(
        classify(&line("// adds one to one")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: RestateEvidence::default()
            }
        }
    );
}

#[test]
fn docstring_with_markup_is_public_api() {
    // Bug: a public-API docstring (with param/return markup) is flagged.
    let comment =
        docstring("\"\"\"Fetches a user.\n    Args:\n        id: the user id.\n    \"\"\"");
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn docstring_without_markup_is_unnecessary() {
    // Bug: a docstring that merely restates the signature is spared.
    assert_eq!(
        classify(&docstring("\"\"\"Fetch the user.\"\"\"")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: RestateEvidence::default()
            }
        }
    );
}

#[test]
fn non_obvious_intent_is_justified() {
    // Bug: a comment explaining *why* (non-obvious intent) is flagged.
    assert_eq!(
        classify(&line("// workaround: the SDK panics on empty input")),
        Verdict::Justified {
            reason: Justification::NonObviousIntent
        }
    );
}

#[test]
fn attribution_is_justified() {
    // Bug: provenance/attribution is flagged.
    assert_eq!(
        classify(&line("// @author Jane Doe")),
        Verdict::Justified {
            reason: Justification::Attribution
        }
    );
}

#[test]
fn generated_file_notice_is_justified() {
    // Bug: a "do not hand-edit this generated file" notice is flagged.
    assert_eq!(
        classify(&line("// THIS FILE IS AUTO-GENERATED - DO NOT EDIT")),
        Verdict::Justified {
            reason: Justification::GeneratedFile
        }
    );
}

#[test]
fn agent_memo_is_unnecessary() {
    // Bug: a memo-style "what changed" note is spared (or mislabelled).
    assert_eq!(
        classify(&line("// changed the retry count from 3 to 5")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::AgentMemo
        }
    );
}

#[test]
fn commented_out_code_is_unnecessary() {
    // Bug: commented-out code is spared (or mislabelled).
    assert_eq!(
        classify(&line("// fmt.Println(\"debug\")")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::CommentedOutCode
        }
    );
}

#[test]
fn vacuous_todo_is_unnecessary() {
    // Bug: a `TODO` with no tracked reference is spared (or mislabelled).
    assert_eq!(
        classify(&line("// TODO: refactor this later")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::VacuousTodo
        }
    );
}

// U3 — restate detection via adjacent-code token containment.

#[test]
fn content_tokens_strips_markers_and_stop_words() {
    use claude_code_comment_checker::classify::content_tokens;
    let tokens = content_tokens("// The encode_string function encodes a string");
    assert!(tokens.contains("encode_string"));
    assert!(tokens.contains("function"));
    assert!(tokens.contains("encodes"));
    assert!(tokens.contains("string"));
    assert!(!tokens.contains("the"));
    assert!(!tokens.contains("a"));
}

#[test]
fn restates_adjacent_full_overlap() {
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// returns the string");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn returns() -> String".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(restates_adjacent(&comment));
}

#[test]
fn restates_adjacent_partial_overlap_above_half() {
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// the encode function");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn encode()".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(restates_adjacent(&comment));
}

#[test]
fn restates_adjacent_returns_false_for_genuinely_explanatory_comment() {
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// off-by-one bug in the tokenizer avoids ASCII prefix collision");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn next_token(&mut self)".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(!restates_adjacent(&comment));
}

#[test]
fn restates_adjacent_returns_false_when_no_adjacent_code() {
    use claude_code_comment_checker::classify::restates_adjacent;
    let comment = line("// whatever");
    assert!(!restates_adjacent(&comment));
}

// U4 — position/scope-aware narrowing of the PublicApiDoc rule.

#[test]
fn docstring_head_without_markup_is_not_a_public_contract() {
    // Position must never justify on its own: the corpus labels a bare summary
    // line above a declaration a restatement, not documentation.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, PositionRole, RestateEvidence, Scope, UnnecessaryKind, Verdict,
    };
    let mut comment = Comment::new("Adds two numbers", 1, CommentType::Docstring);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::DocstringHead,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: RestateEvidence::default()
            },
        }
    );
}

#[test]
fn docstring_head_with_markup_is_a_public_contract() {
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new(
        "Adds two numbers.\n\nArgs:\n    a: first addend\n",
        1,
        CommentType::Docstring,
    );
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::DocstringHead,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc,
        }
    );
}

#[test]
fn trailing_docstring_with_markup_is_not_a_public_contract() {
    // U4's narrowing: doc markup beside a statement documents nothing.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("@param a first addend", 1, CommentType::Docstring);
    comment.context = Some(CommentContext {
        adjacent_code: Some("total = 0".into()),
        annotates_declaration: false,
        scope: Scope::Module,
        position: PositionRole::Trailing,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc,
        }
    );
}

#[test]
fn line_comment_with_lead_contract_markup_is_a_public_contract() {
    // U4: contract markup leading a line comment at a contract position is
    // interface documentation — the tag is the contract, whatever the comment
    // syntax. `DocstringHead` is still positional: what changed is that
    // markup-at-start now certifies a *line* comment, where the old rule
    // required the Docstring type.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Returns: the user", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn user() -> User".into()),
        annotates_declaration: true,
        scope: Scope::Module,
        position: PositionRole::DocstringHead,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc,
        }
    );
}

#[test]
fn line_contract_markup_mid_sentence_is_not_justified() {
    // A prose comment mentioning `@param` mid-sentence is not over-justified:
    // the markup must lead the comment to count as a contract.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new(
        "use @param only when the code is ambiguous",
        1,
        CommentType::Line,
    );
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc,
        }
    );
}

#[test]
fn line_contract_markup_beside_a_statement_is_not_justified() {
    // A tag trailing a statement or inline with it documents nothing.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Returns: the user", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("total = 0".into()),
        annotates_declaration: false,
        scope: Scope::Module,
        position: PositionRole::Trailing,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc,
        }
    );
}

#[test]
fn assignment_shaped_comment_is_commented_out_code() {
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    assert_eq!(
        classify(&line("// x = x + 1")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::CommentedOutCode,
        }
    );
}

#[test]
fn prose_containing_an_equals_sign_is_not_commented_out_code() {
    // The assignment check must not swallow explanatory prose: a multi-word
    // left side is not an identifier path.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    assert_ne!(
        classify(&line("// set retries = 3 because the API flaps")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::CommentedOutCode,
        }
    );
}

#[test]
fn value_legend_with_numeric_left_side_is_not_commented_out_code() {
    // `1` is not an assignment target, so a legend documenting an encoding is
    // not dead code. Pins both conjuncts of the assignment shape: a non-empty
    // left side is not sufficient, and being all path characters is not
    // sufficient — it must also *start* like an identifier.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    assert_ne!(
        classify(&line("// 1 = enabled, 2 = disabled")),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::CommentedOutCode,
        }
    );
}

// Boundary tests — exist specifically to kill mutants that survived
// `cargo mutants`. Each one names the precise boundary it pins.

#[test]
fn restates_adjacent_empty_comment_tokens_returns_false() {
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// /// *** only markup and stop words");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn encode()".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(!restates_adjacent(&comment));
}

#[test]
fn restates_adjacent_intermediate_containment_returns_false() {
    // comment has 3 content tokens, 1 shared with adjacent → containment 1/3 ≈ 0.33.
    // The mutant that replaces `/` with `*` reports a score of 1*3=3 ≥ 0.5 (true).
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// hello world friend");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn hello()".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(!restates_adjacent(&comment));
}

#[test]
fn restates_adjacent_requires_both_intersection_and_containment() {
    // mutant 121 changes `&&` to `||`. With no intersection and small comment, the
    // containment is 0 → real false. Mutant: 0 >= 1 is false, but containment_>=0.5
    // is also false, so this case wouldn't kill 121 alone — see the previous test
    // for that. This test pins the AND structure for a different configuration.
    use claude_code_comment_checker::classify::restates_adjacent;
    use claude_code_comment_checker::{CommentContext, PositionRole, Scope};
    let mut comment = line("// alpha beta");
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn gamma()".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert!(!restates_adjacent(&comment));
}

#[test]
fn public_api_doc_requires_position_to_be_docstring_head() {
    // mutant 197 changes `&&` between position and scope to `||`.
    // Here position = Trailing, scope = Function → real returns false
    // (chain broken at the position check); mutant returns true (scope passes
    // and either-bound is enough).
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Adds two numbers", 1, CommentType::Docstring);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Trailing,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn public_api_doc_requires_attachment_to_a_declaration() {
    // A leading docstring above an ordinary statement documents nothing:
    // `annotates_declaration: false` must block the structural promotion.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Adds two numbers", 1, CommentType::Docstring);
    comment.context = Some(CommentContext {
        adjacent_code: Some("x = 1".into()),
        annotates_declaration: false,
        scope: Scope::NestedBlock,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn public_api_doc_promotes_leading_docstring_on_a_declaration() {
    // Brace-language shape: the doc comment precedes the declaration it
    // documents, so it is never a DocstringHead but is still a public contract.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new(
        "Wraps the retry budget.\n@param limit upper bound\n",
        1,
        CommentType::Docstring,
    );
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn spawn(limit: usize) -> Handle".into()),
        annotates_declaration: true,
        scope: Scope::Module,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn public_api_doc_revoked_when_docstring_restates_the_signature() {
    // U3 constrains U4: a docstring whose vocabulary is already in the
    // signature is a signature echo, not documentation.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("returns the sum", 1, CommentType::Docstring);
    comment.context = Some(CommentContext {
        adjacent_code: Some("int sum(int a, int b) { return a + b; }".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn public_api_doc_requires_docstring_type_through_u4_chain() {
    // mutant 199 changes the `&&` before the comment_type check to `||`.
    // A comment WITHOUT context but WITH docstring markup must still return
    // true through the markup branch (which is unaffected) — confirming the
    // AND branch also requires comment_type=Docstring.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Plain prose without markup", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add()".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::DocstringHead,
        unreliable: false,
    });
    assert_ne!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

#[test]
fn module_head_docstring_with_markup_is_a_public_contract() {
    // A module docstring occupies the file's own head slot; with contract
    // markup it documents the module's public surface.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new(
        "\"\"\"Library entry point.\n\nAttributes:\n    VERSION: semver string\n\"\"\"",
        1,
        CommentType::Docstring,
    );
    comment.context = Some(CommentContext {
        adjacent_code: Some("import os".into()),
        annotates_declaration: false,
        scope: Scope::Module,
        position: PositionRole::DocstringHead,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::PublicApiDoc
        }
    );
}

// Unreliable-context downgrade: a fallback `RestatesCode` verdict for an
// Edit/MultiEdit fragment must downgrade to `Justified` (NonObviousIntent).
// A real rule match (VacuousTodo, AgentMemo) still wins regardless.

#[test]
fn unreliable_context_downgrades_fallback_restate_to_justified() {
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("Adds two numbers", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: true,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::NonObviousIntent,
        }
    );
}

#[test]
fn reliable_context_keeps_fallback_restate_as_unnecessary() {
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, PositionRole, RestateEvidence, Scope, UnnecessaryKind, Verdict,
    };
    let mut comment = Comment::new("Adds two numbers", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("pub fn add(a: i32, b: i32) -> i32".into()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: RestateEvidence::default()
            },
        }
    );
}

// U3 — the context-aware restatement detector, with cited evidence.

fn context_comment(text: &str, adjacent: &str) -> Comment {
    let mut comment = Comment::new(text, 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some(adjacent.to_owned()),
        annotates_declaration: true,
        scope: Scope::Function,
        position: PositionRole::Leading,
        unreliable: false,
    });
    comment
}

#[test]
fn restate_cites_lexical_overlap() {
    // `// counter` beside `counter += 1` is a literal restatement; the verdict
    // carries the cited token so the block report can show it.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    let comment = context_comment("// counter", "counter += 1");
    let classify = classify(&comment);
    let Verdict::Unnecessary {
        reason: UnnecessaryKind::RestatesCode { evidence },
    } = &classify
    else {
        panic!("expected RestatesCode, got {classify:?}");
    };
    assert_eq!(evidence.lexical, vec!["counter".to_owned()]);
    assert!(evidence.operator.is_empty());
}

#[test]
fn restate_cites_operator_paraphrase() {
    // `// increment the counter` beside `counter += 1` is a paraphrased
    // restatement: lexical overlap on `counter` plus the verb→operator table
    // match `increment` ↔ `+=`.
    use claude_code_comment_checker::UnnecessaryKind;
    use claude_code_comment_checker::classify::classify;
    let comment = context_comment("// increment the counter", "counter += 1");
    let classify = classify(&comment);
    let Verdict::Unnecessary {
        reason: UnnecessaryKind::RestatesCode { evidence },
    } = &classify
    else {
        panic!("expected RestatesCode, got {classify:?}");
    };
    assert_eq!(evidence.lexical, vec!["counter".to_owned()]);
    assert_eq!(
        evidence.operator,
        vec![("increment".to_owned(), "+=".to_owned())]
    );
}

#[test]
fn restate_matches_operator_even_without_lexical_overlap() {
    // `decrements` shares no token with `i -= 1`, but the operator table
    // still catches the paraphrase.
    use claude_code_comment_checker::UnnecessaryKind;
    use claude_code_comment_checker::classify::classify;
    let comment = context_comment("// decrements the counter", "i -= 1");
    let classify = classify(&comment);
    let Verdict::Unnecessary {
        reason: UnnecessaryKind::RestatesCode { evidence },
    } = &classify
    else {
        panic!("expected RestatesCode, got {classify:?}");
    };
    assert!(evidence.lexical.is_empty());
    assert_eq!(
        evidence.operator,
        vec![("decrements".to_owned(), "-=".to_owned())]
    );
}

#[test]
fn restate_never_convicts_higher_abstraction_comment() {
    // The precision moat: a comment that adds a constraint/why the code lacks
    // is spared even next to restating words.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{Justification, Verdict};
    let comment = context_comment("// throttle to avoid the rate limit", "sleep(delay)");
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::NonObviousIntent,
        }
    );
    // …and a justified comment that merely shares a word with the code is not
    // convicted on the overlap alone.
    let comment = context_comment(
        "// counter reads 1-based; code below is 0-based",
        "let counter = 0;",
    );
    assert!(matches!(classify(&comment), Verdict::Justified { .. }));
}

#[test]
fn restate_operator_table_requires_the_operator_in_code() {
    // `add` must not fire just because a verb is in the table — the matched
    // operator has to actually appear in the adjacent code.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    let comment = context_comment("// add retries", "address = resolve()");
    assert_eq!(
        classify(&comment),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: claude_code_comment_checker::RestateEvidence::default(),
            },
        }
    );
}

#[test]
fn restates_signature_with_lexical_evidence() {
    // `// returns the user` beside `pub fn user()` is the classic signature
    // echo: flagged, citing `user` (lexical overlap). The operator table does
    // NOT fire — `return` never appears in this signature, and a verb in the
    // table is not enough without its operator in the code.
    use claude_code_comment_checker::UnnecessaryKind;
    use claude_code_comment_checker::classify::classify;
    let comment = context_comment("// returns the user", "pub fn user() -> User");
    let classify = classify(&comment);
    let Verdict::Unnecessary {
        reason: UnnecessaryKind::RestatesCode { evidence },
    } = &classify
    else {
        panic!("expected RestatesCode, got {classify:?}");
    };
    assert_eq!(evidence.lexical, vec!["user".to_owned()]);
    assert!(evidence.operator.is_empty());
}

#[test]
fn restate_detector_does_not_run_on_unreliable_context() {
    // Fragment-bounded context (Edit/MultiEdit) must never drive a conviction:
    // restate evidence stays empty there and the conservative downgrade wins.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{
        CommentContext, CommentType, Justification, PositionRole, Scope, Verdict,
    };
    let mut comment = Comment::new("// increment the counter", 1, CommentType::Line);
    comment.context = Some(CommentContext {
        adjacent_code: Some("counter += 1".into()),
        annotates_declaration: false,
        scope: Scope::Module,
        position: PositionRole::Inline,
        unreliable: true,
    });
    assert_eq!(
        classify(&comment),
        Verdict::Justified {
            reason: Justification::NonObviousIntent,
        }
    );
}

#[test]
fn restate_word_operators_match_as_tokens_not_substrings() {
    // `return_value` contains the letters of `return` but is not the keyword:
    // the operator path must not fire on the substring. This pins the
    // alphanumeric-vs-symbolic split in `code_contains_operator`.
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    let comment = context_comment("// returns the value", "let return_value = 1;");
    assert_eq!(
        classify(&comment),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: claude_code_comment_checker::RestateEvidence::default(),
            },
        }
    );
}

#[test]
fn restate_evidence_needs_containment_not_any_overlap() {
    // One shared token out of three is not a restatement claim: the evidence
    // stays empty (the mutant that turns `/` into `*` would fire on any
    // nonzero overlap and must die).
    use claude_code_comment_checker::classify::classify;
    use claude_code_comment_checker::{UnnecessaryKind, Verdict};
    let comment = context_comment("// alpha beta gamma", "let alpha = 1;");
    assert_eq!(
        classify(&comment),
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: claude_code_comment_checker::RestateEvidence::default(),
            },
        }
    );
}
