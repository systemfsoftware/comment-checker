//! Detection-layer contract tests: the structural context derived from a real
//! parse, per grammar.
//!
//! Every case here pins a defect that shipped once: a grammar whose docstrings
//! went undetected, a doc comment counted twice, adjacent code taken from the
//! wrong side, and a docstring-head role assigned to a comment with code above
//! it. The classifier tests cannot see any of these — they hand-build context.

use claude_code_comment_checker::detect::detect_comments;
use claude_code_comment_checker::{Comment, CommentType, PositionRole, Scope};

fn only(src: &str, path: &str) -> Comment {
    let mut found = detect_comments(src, path);
    assert_eq!(
        found.len(),
        1,
        "expected exactly one comment in {path}, got {:?}",
        found.iter().map(|c| c.text.clone()).collect::<Vec<_>>()
    );
    found.remove(0)
}

#[test]
fn python_module_docstring_is_detected_at_the_file_head() {
    let comment = only("\"\"\"Module docstring.\"\"\"\nimport os\n", "a.py");
    assert_eq!(comment.comment_type, CommentType::Docstring);
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::DocstringHead);
    assert_eq!(ctx.scope, Scope::Module);
}

#[test]
fn python_function_docstring_is_detected_inside_the_body() {
    let comment = only(
        "def f(x):\n    \"\"\"Fetch the user.\"\"\"\n    return x\n",
        "a.py",
    );
    assert_eq!(comment.comment_type, CommentType::Docstring);
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::DocstringHead);
    assert_eq!(ctx.scope, Scope::Function);
}

#[test]
fn rust_doc_comment_is_detected_exactly_once() {
    // tree-sitter-rust nests a content node inside `///`; descending into a
    // comment emitted a marker-stripped phantom comment alongside the real one.
    let comment = only(
        "/// Adds two numbers.\npub fn add(a: i32, b: i32) -> i32 { a + b }\n",
        "a.rs",
    );
    assert_eq!(comment.comment_type, CommentType::Docstring);
    assert!(
        comment.text.starts_with("///"),
        "text was {:?}",
        comment.text
    );
}

#[test]
fn leading_comment_annotates_the_code_below_it_not_above() {
    // A Go doc comment sits after the package clause and before the function it
    // documents; the annotated code is the function.
    let comment = only(
        "package main\n\n// Add adds two numbers.\nfunc Add(a, b int) int { return a + b }\n",
        "a.go",
    );
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::Leading);
    let adjacent = ctx.adjacent_code.expect("adjacent code");
    assert!(
        adjacent.contains("func Add"),
        "adjacent code was {adjacent:?}"
    );
    assert!(ctx.annotates_declaration);
}

#[test]
fn doc_comment_on_a_later_class_member_is_leading_not_docstring_head() {
    // A field precedes this Javadoc, so it does not occupy the body's head slot.
    let comment = only(
        "class A {\n  int x;\n  /** Returns the sum. */\n  int add(int a, int b) { return a + b; }\n}\n",
        "A.java",
    );
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::Leading);
    let adjacent = ctx.adjacent_code.expect("adjacent code");
    assert!(
        adjacent.contains("int add"),
        "adjacent code was {adjacent:?}"
    );
}

#[test]
fn trailing_comment_annotates_the_statement_beside_it() {
    let comment = only("counter += 1  # increment the counter\n", "a.py");
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::Inline);
    assert_eq!(ctx.adjacent_code.as_deref(), Some("counter += 1"));
    assert!(!ctx.annotates_declaration);
}

#[test]
fn comment_inside_a_loop_reports_nested_block_scope() {
    // U2 scenario: a comment inside a loop body is unambiguously nested, and
    // its adjacent code is the loop statement it annotates.
    let comment = only(
        "for x in xs:\n    # filter the results\n    filtered.append(x)\n",
        "a.py",
    );
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.scope, Scope::NestedBlock);
    assert_eq!(ctx.position, PositionRole::Leading);
    assert_eq!(ctx.adjacent_code.as_deref(), Some("filtered.append(x)"));
}

#[test]
fn comment_above_a_plain_statement_does_not_annotate_a_declaration() {
    // `PositionRole` is positional: a comment first in the file occupies the
    // head slot even though it is not a docstring. What keeps that safe is the
    // `comment_type == Docstring` gate in the public-contract rule, pinned by
    // `line_comment_in_head_slot_is_not_a_public_contract` in tests/classify.rs.
    let comment = only("# increment the counter\ncounter += 1\n", "a.py");
    let ctx = comment.context.expect("context");
    assert_eq!(ctx.position, PositionRole::DocstringHead);
    assert_eq!(ctx.adjacent_code.as_deref(), Some("counter += 1"));
    assert!(!ctx.annotates_declaration);
}

#[test]
fn comment_below_a_statement_is_not_in_the_head_slot() {
    let comments = detect_comments(
        "counter = 0\n# increment the counter\ncounter += 1\n",
        "a.py",
    );
    let comment = comments
        .iter()
        .find(|c| c.text.contains("increment"))
        .expect("comment detected");
    let ctx = comment.context.as_ref().expect("context");
    assert_eq!(ctx.position, PositionRole::Leading);
    assert_eq!(ctx.adjacent_code.as_deref(), Some("counter += 1"));
}

#[test]
fn detected_comments_carry_context_but_hand_built_ones_do_not() {
    // The absent-context path is what keeps the text-only floor reachable.
    let detected = only("# increment the counter\ncounter += 1\n", "a.py");
    assert!(detected.context.is_some());
    let hand_built = Comment::new("# increment the counter", 1, CommentType::Line);
    assert!(hand_built.context.is_none());
}
