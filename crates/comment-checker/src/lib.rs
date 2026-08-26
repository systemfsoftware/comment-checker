//! `claude-code-comment-checker` — classify code comments as justified or unnecessary.
//!
//! A Claude Code `PostToolUse` hook: it reads the hook payload, detects the
//! comments in the just-written code, classifies each as justified or
//! unnecessary, and blocks (exit 2) when any are unnecessary. Pass `--strip`
//! to delete whole-line flagged comments from the file on disk.
//!
//! Split along the functional-core/imperative-shell seam (CONST-B1): the pure
//! core is [`classify`], and the shell reads stdin, drives tree-sitter
//! ([`detect`]), and writes the report — or, with `--strip`, the file.

pub mod check;
pub mod classify;
pub mod comment;
pub mod detect;
pub mod hook;
pub mod language;
pub mod report;
pub mod strip;

pub use check::{Outcome, check, check_source};
pub use classify::classify;
pub use comment::{
    Comment, CommentContext, CommentType, Justification, PositionRole, RestateEvidence, Scope,
    UnnecessaryKind, Verdict,
};
pub use report::{Finding, format_strip_report};
pub use strip::{StripPlan, plan_strip};
