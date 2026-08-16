//! Extract comments from source using tree-sitter, with structural context.

use crate::comment::{Comment, CommentContext, CommentType, PositionRole, Scope};
use crate::language::{language_for_name, language_name_for_path};
use tree_sitter::{Node, Parser};

/// Node kinds that denote comments across grammars.
const COMMENT_KINDS: &[&str] = &[
    "comment",
    "line_comment",
    "block_comment",
    "multiline_comment",
    "doc_comment",
    "documentation_comment",
];

/// Find every comment in `content`, treating it as a file named `file_path`.
#[must_use]
pub fn detect_comments(content: &str, file_path: &str) -> Vec<Comment> {
    let Some(language_name) = language_name_for_path(file_path) else {
        return Vec::new();
    };
    let Some(language) = language_for_name(language_name) else {
        return Vec::new();
    };

    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(content.as_bytes(), None) else {
        return Vec::new();
    };

    let bytes = content.as_bytes();
    let mut comments = collect_comments(tree.root_node(), bytes);

    if language_name == "python" {
        comments.extend(collect_python_docstrings(tree.root_node(), bytes));
    }
    comments.sort_by_key(|c| c.line_number);
    comments
}

fn comment_type(node_kind: &str, text: &str) -> CommentType {
    let t = text.trim_start();
    if t.starts_with("///") || t.starts_with("//!") || t.starts_with("/**") || t.starts_with("/*!")
    {
        CommentType::Docstring
    } else if node_kind.contains("block") || node_kind.contains("multiline") || t.starts_with("/*")
    {
        CommentType::Block
    } else {
        CommentType::Line
    }
}

fn is_comment_kind(node: &Node<'_>) -> bool {
    COMMENT_KINDS.contains(&node.kind())
}

/// Build a [`Comment`] from a comment-bearing node.
fn comment_from(node: Node<'_>, bytes: &[u8], forced_type: Option<CommentType>) -> Comment {
    let text = node.utf8_text(bytes).unwrap_or_default().to_owned();
    let comment_type = forced_type.unwrap_or_else(|| comment_type(node.kind(), &text));
    Comment {
        text,
        line_number: node.start_position().row + 1,
        comment_type,
        context: Some(derive_context(node, bytes)),
    }
}

/// Walk the tree, collecting every comment node with its structural context.
///
/// A comment node's children are never visited: grammars such as
/// tree-sitter-rust nest an inner content node inside `///` doc comments, and
/// descending would emit a marker-stripped phantom comment alongside the real
/// one.
fn collect_comments(root: Node<'_>, bytes: &[u8]) -> Vec<Comment> {
    let mut comments = Vec::new();
    let mut cursor = root.walk();
    'walk: loop {
        let node = cursor.node();
        let is_comment = is_comment_kind(&node);
        if is_comment {
            comments.push(comment_from(node, bytes, None));
        }
        // Descend only into non-comment nodes.
        if !is_comment && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                break 'walk;
            }
        }
    }
    comments
}

/// Python docstrings are string expressions, not comment nodes: the first
/// statement of a module, class body or function body when that statement is a
/// bare string. Walked directly rather than queried so a grammar change
/// degrades to "not a docstring" instead of silently matching nothing.
fn collect_python_docstrings(root: Node<'_>, bytes: &[u8]) -> Vec<Comment> {
    let mut docstrings = Vec::new();
    let mut cursor = root.walk();
    'walk: loop {
        let node = cursor.node();
        if is_python_docstring(node) {
            docstrings.push(comment_from(node, bytes, Some(CommentType::Docstring)));
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                break 'walk;
            }
        }
    }
    docstrings
}

/// True when `node` is a `string` that forms the entire first statement of a
/// module or of a class/function body.
///
/// Two grammar shapes are accepted: current tree-sitter-python makes the
/// docstring a direct `string` child of `module`/`block`, while older versions
/// wrapped it in an `expression_statement`. Matching both means a grammar bump
/// cannot silently turn docstring detection off.
fn is_python_docstring(node: Node<'_>) -> bool {
    if node.kind() != "string" {
        return false;
    }
    let Some(parent) = node.parent() else {
        return false;
    };
    // The statement that stands in the container's child list.
    let statement = if parent.kind() == "expression_statement" {
        parent
    } else {
        node
    };
    let Some(container) = statement.parent() else {
        return false;
    };
    if !matches!(container.kind(), "module" | "block") {
        return false;
    }
    let Some(first) = container.named_child(0) else {
        return false;
    };
    first.id() == statement.id()
}

/// Derive the structural context for a comment node.
///
/// The adjacent code is the code the comment *annotates*: the next non-comment
/// sibling for a leading comment, falling back to the previous sibling for a
/// trailing or inline comment that has nothing after it.
fn derive_context(node: Node<'_>, bytes: &[u8]) -> CommentContext {
    let line = node.start_position().row;
    let prev = code_sibling(node, Direction::Prev);
    let next = code_sibling(node, Direction::Next);

    let inline = prev.is_some_and(|p| p.end_position().row == line);
    let position = if inline {
        PositionRole::Inline
    } else if is_docstring_head(node) {
        PositionRole::DocstringHead
    } else if next.is_some() {
        PositionRole::Leading
    } else if prev.is_some() {
        PositionRole::Trailing
    } else {
        PositionRole::Leading
    };

    // A leading comment annotates what follows; a trailing/inline one annotates
    // what precedes it.
    let annotated = match position {
        PositionRole::Trailing | PositionRole::Inline => prev.or(next),
        PositionRole::Leading | PositionRole::DocstringHead => next.or(prev),
    };

    CommentContext {
        adjacent_code: annotated.and_then(|n| adjacent_text_from(n, bytes)),
        annotates_declaration: annotated.is_some_and(|n| is_declaration(n)),
        scope: derive_scope(node),
        position,
        unreliable: false,
    }
}

/// True when `node` declares a named contract rather than performing a step.
/// Wrapper nodes (Go's `declaration`, Java's `..._declaration`) are unwrapped
/// one level so a doc comment before `func Add(...)` still sees a declaration.
fn is_declaration(node: Node<'_>) -> bool {
    let kind = node.kind();
    if is_function_like(kind) || is_class_like(kind) {
        return true;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .any(|child| is_function_like(child.kind()) || is_class_like(child.kind()))
}

#[derive(Clone, Copy)]
enum Direction {
    Prev,
    Next,
}

/// The nearest sibling that is real code — skipping comments and punctuation.
fn code_sibling(node: Node<'_>, direction: Direction) -> Option<Node<'_>> {
    let mut current = node;
    loop {
        let sibling = match direction {
            Direction::Prev => current.prev_sibling(),
            Direction::Next => current.next_sibling(),
        }?;
        if !is_comment_kind(&sibling) && !is_trivia(&sibling) {
            return Some(sibling);
        }
        current = sibling;
    }
}

/// The annotated code's source text, truncated to keep reports bounded.
fn adjacent_text_from(node: Node<'_>, bytes: &[u8]) -> Option<String> {
    let text = node.utf8_text(bytes).unwrap_or("").trim();
    if text.is_empty() {
        None
    } else {
        Some(truncate(text, 240))
    }
}

/// Scope derivation: inside a function-like or class-like ancestor → `Function`;
/// inside a nested block → `NestedBlock`; otherwise `Module`.
fn derive_scope(node: Node<'_>) -> Scope {
    let mut parent = node.parent();
    let mut saw_block = false;
    while let Some(current) = parent {
        let kind = current.kind();
        if is_function_like(kind) || is_class_like(kind) {
            return Scope::Function;
        }
        if is_nested_block(kind) {
            saw_block = true;
        }
        parent = current.parent();
    }
    if saw_block {
        Scope::NestedBlock
    } else {
        Scope::Module
    }
}

fn is_function_like(kind: &str) -> bool {
    matches!(
        kind,
        "function"
            | "function_item"
            | "function_definition"
            | "function_declaration"
            | "function_signature_item"
            | "method"
            | "method_definition"
            | "method_declaration"
            | "singleton_method"
            | "generator_function"
            | "generator_function_definition"
            | "arrow_function"
            | "lambda"
    )
}

fn is_class_like(kind: &str) -> bool {
    matches!(
        kind,
        "class"
            | "class_definition"
            | "class_declaration"
            | "impl_item"
            | "trait_item"
            | "struct_item"
            | "enum_item"
            | "interface_declaration"
    )
}

fn is_nested_block(kind: &str) -> bool {
    matches!(
        kind,
        "block"
            | "statement_block"
            | "compound_statement"
            | "do_statement"
            | "while_statement"
            | "for_statement"
            | "for_in_statement"
            | "enhanced_for_statement"
            | "if_statement"
            | "try_statement"
            | "switch_statement"
            | "match_statement"
    )
}

/// A comment is a docstring head only when it is the first non-trivia child of
/// a declaration's body, or of the file itself — nothing but trivia may
/// precede it. A doc comment on the second member of a class is a leading
/// comment, not a docstring head.
fn is_docstring_head(node: Node<'_>) -> bool {
    let Some(parent) = node.parent() else {
        return false;
    };
    let parent_kind = parent.kind();
    // The head slot exists either at file scope (a module docstring) or at the
    // top of a declaration's body block.
    let at_file_scope = is_file_root(parent_kind);
    if !at_file_scope {
        if !is_body_block(parent_kind) {
            return false;
        }
        let Some(grandparent) = parent.parent() else {
            return false;
        };
        if !is_function_like(grandparent.kind()) && !is_class_like(grandparent.kind()) {
            return false;
        }
    }
    let mut cursor = parent.walk();
    for child in parent.children(&mut cursor) {
        if child.id() == node.id() {
            return true;
        }
        if !is_trivia(&child) {
            // Real code (or an earlier comment) precedes this one.
            return false;
        }
    }
    false
}

/// Root node kinds: the whole-file container for a grammar.
fn is_file_root(kind: &str) -> bool {
    matches!(
        kind,
        "module" | "program" | "source_file" | "translation_unit"
    )
}

fn is_body_block(kind: &str) -> bool {
    matches!(
        kind,
        "block" | "statement_block" | "body" | "suite" | "class_body" | "block_statement"
    )
}

/// Punctuation and layout nodes that sit between real code tokens.
fn is_trivia(node: &Node<'_>) -> bool {
    matches!(
        node.kind(),
        "{" | "}" | "(" | ")" | ";" | "," | ":" | "newline" | "indent" | "dedent"
    )
}

fn truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_owned();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = s[..end].to_owned();
    out.push('…');
    out
}
