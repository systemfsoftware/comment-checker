//! `claude-code-comment-checker` — classify code comments as justified or unnecessary.
//!
//! A Claude Code `PostToolUse` hook: it reads the hook payload, detects the
//! comments in the just-written code, classifies each as justified or
//! unnecessary, and blocks (exit 2) when any are unnecessary.
//!
//! Split along the functional-core/imperative-shell seam (CONST-B1): the pure
//! core is [`classify`], and the shell reads stdin, drives tree-sitter
//! ([`detect`]), and writes the report.

pub mod check;
pub mod classify;
pub mod comment;
pub mod detect;
pub mod hook;
pub mod language;
pub mod report;

pub use check::{Outcome, check};
pub use classify::classify;
pub use comment::{
    Comment, CommentContext, CommentType, Justification, PositionRole, RestateEvidence, Scope,
    UnnecessaryKind, Verdict,
};
