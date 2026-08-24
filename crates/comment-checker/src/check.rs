//! The check use case: decode → detect → classify → report (all pure).

use crate::Verdict;
use crate::classify::classify;
use crate::comment::{Comment, PositionRole};
use crate::detect::detect_comments;
use crate::hook::{HookInput, decode};
use crate::report::{Flagged, format_report};

/// The outcome of a hook check: pass (with a note) or block (with a report).
#[derive(Debug, Eq, PartialEq)]
pub enum Outcome {
    Pass { note: String },
    Block { report: String },
}

/// Run the check over the raw hook JSON.
#[must_use]
pub fn check(input: &str, custom_prompt: &str) -> Outcome {
    let Some(hook) = decode(input) else {
        return pass("Invalid input format");
    };
    let file_path = hook.tool_input.file_path.as_str();
    if file_path.is_empty() {
        return pass("No file path provided");
    }

    let comments = detect_for(&hook, file_path);
    let flagged = flag_unnecessary(&comments);
    if flagged.is_empty() {
        return pass("No unnecessary comments found");
    }

    Outcome::Block {
        report: format_report(&flagged, file_path, custom_prompt),
    }
}

/// The content a tool writes, and for edits only the newly-added comments.
fn detect_for(hook: &HookInput, file_path: &str) -> Vec<Comment> {
    match hook.tool_name.as_str() {
        "Edit" => new_comments(
            &hook.tool_input.old_string,
            &hook.tool_input.new_string,
            file_path,
        ),
        "MultiEdit" => hook
            .tool_input
            .edits
            .iter()
            .flat_map(|edit| new_comments(&edit.old_string, &edit.new_string, file_path))
            .collect(),
        "Write" => detect_comments(&hook.tool_input.content, file_path),
        _ if !hook.tool_input.content.is_empty() => {
            detect_comments(&hook.tool_input.content, file_path)
        }
        _ => detect_comments(&hook.tool_input.new_string, file_path),
    }
}

/// Comments present in `new` but not in `old`, by normalized text.
fn new_comments(old: &str, new: &str, file_path: &str) -> Vec<Comment> {
    let old_texts: Vec<String> = detect_comments(old, file_path)
        .into_iter()
        .map(|comment| normalize(&comment))
        .collect();
    detect_comments(new, file_path)
        .into_iter()
        .filter(|comment| !old_texts.contains(&normalize(comment)))
        .map(mark_fragment_edge_context)
        .collect()
}

fn mark_fragment_edge_context(mut comment: Comment) -> Comment {
    if let Some(ctx) = comment.context.as_mut() {
        ctx.unreliable = ctx.adjacent_code.is_none() || ctx.position == PositionRole::Trailing;
    }
    comment
}

fn normalize(comment: &Comment) -> String {
    comment.text.trim().to_ascii_lowercase()
}

/// Keep only the comments the classifier marks unnecessary.
fn flag_unnecessary(comments: &[Comment]) -> Vec<Flagged<'_>> {
    comments
        .iter()
        .filter_map(|comment| match classify(comment) {
            Verdict::Unnecessary { reason } => Some(Flagged {
                comment,
                kind: reason,
            }),
            Verdict::Justified { .. } => None,
        })
        .collect()
}

fn pass(note: &str) -> Outcome {
    Outcome::Pass {
        note: format!("[check-comments] Skipping: {note}\n"),
    }
}
