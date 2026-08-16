//! The domain model: a comment and the verdict a classifier assigns.

/// How a comment is written in source.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum CommentType {
    Line,
    Block,
    Docstring,
}

/// Position role of a comment relative to its surrounding code.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum PositionRole {
    /// The comment occupies the head slot of a body: the first non-trivia child
    /// of a declaration's body, or of the file itself.
    ///
    /// This is **positional only** — a `#` line comment at the top of a file
    /// occupies the slot without being a docstring. Rules that treat the slot as
    /// evidence of documentation must also require
    /// [`CommentType::Docstring`].
    DocstringHead,
    /// Comment precedes any code on the same statement block.
    Leading,
    /// Comment follows code on the same statement block.
    Trailing,
    /// Comment sits on the same line as a code token (covers end-of-line comments).
    Inline,
}

/// Coarse syntactic scope where a comment lives.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Scope {
    Module,
    Function,
    NestedBlock,
}

/// Structural context for a comment, captured by the tree-sitter walk.
///
/// `unreliable` flags context that may be incomplete at the edge of an
/// `Edit`/`MultiEdit` fragment — the runtime must not convict on unreliable
/// context and instead fall back to the text-only path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommentContext {
    /// The code this comment annotates: the next non-comment sibling for a
    /// leading comment, or the preceding one for a trailing/inline comment.
    pub adjacent_code: Option<String>,
    /// True when the annotated code is a declaration (function, method, class,
    /// impl, trait, struct) rather than an ordinary statement. A doc comment
    /// attached to a declaration documents a contract; one attached to a
    /// statement does not.
    pub annotates_declaration: bool,
    pub scope: Scope,
    pub position: PositionRole,
    /// Set when the context may be incomplete at the edge of an `Edit` or
    /// `MultiEdit` fragment. The classifier must not convict on the catch-all
    /// path when this is set.
    pub unreliable: bool,
}

impl Default for CommentContext {
    fn default() -> Self {
        Self {
            adjacent_code: None,
            annotates_declaration: false,
            scope: Scope::Module,
            position: PositionRole::Leading,
            unreliable: false,
        }
    }
}

/// A comment found in source, before classification.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Comment {
    /// Comment text as written, including its syntactic markers.
    pub text: String,
    /// 1-based line number of the comment's start.
    pub line_number: usize,
    /// Syntactic form of the comment.
    pub comment_type: CommentType,
    /// Structural context, populated by the detector.
    /// `None` means the classifier must use the text-only path.
    pub context: Option<CommentContext>,
}

impl Comment {
    #[must_use]
    pub fn new(text: impl Into<String>, line_number: usize, comment_type: CommentType) -> Self {
        Self {
            text: text.into(),
            line_number,
            comment_type,
            context: None,
        }
    }
}

/// Why a comment is worth keeping.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Justification {
    /// A `#!` interpreter line.
    Shebang,
    /// A license, copyright, or SPDX header.
    LicenseHeader,
    /// A notice that the file is generated and must not be hand-edited.
    GeneratedFile,
    /// A linter or type-checker directive (`# noqa`, `// @ts-ignore`, …).
    LinterDirective,
    /// A BDD step keyword (`# given`, `# when`, `# then`, …).
    BddStep,
    /// A docstring documenting a public contract.
    PublicApiDoc,
    /// A comment explaining non-obvious intent (`why`, `because`, …).
    NonObviousIntent,
    /// Attribution or provenance (`@author`, `adapted from`, …).
    Attribution,
}

/// Why a comment should be removed.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub enum UnnecessaryKind {
    /// A memo-style note describing what changed, not why.
    AgentMemo,
    /// Code that has been commented out.
    CommentedOutCode,
    /// A `TODO`/`FIXME` with no tracked reference.
    VacuousTodo,
    /// A comment that narrates a control-flow construct (`loop`, `iterate`)
    /// that the adjacent code already expresses (`for`, `while`, …). The
    /// cited (verb, construct) pair proves the narration (U5).
    NarratesControlFlow {
        verb: &'static str,
        construct: &'static str,
    },
    /// A comment that merely restates what the code already says, with the
    /// cited overlap that proves the restatement (U3).
    RestatesCode { evidence: RestateEvidence },
}

/// The evidence that a comment restates its adjacent code (KTD3).
///
/// The verdict is only as trustworthy as the citation: an empty `lexical` and
/// `operator` list marks the terminal text-only path (zero-overlap filler),
/// never a context-aware claim.
#[derive(Clone, Debug, Default, Eq, PartialEq, Hash)]
pub struct RestateEvidence {
    /// Comment tokens that also appear in the adjacent code, in comment order.
    pub lexical: Vec<String>,
    /// `(comment verb, code operator)` pairs from the deterministic synonym
    /// table — `increment` ↔ `+=`, `returns` ↔ `return`, …
    pub operator: Vec<(String, String)>,
}

impl RestateEvidence {
    /// True when neither path produced a citation.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.lexical.is_empty() && self.operator.is_empty()
    }
}

/// The classification decision for a single comment.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Verdict {
    /// Keep this comment — it serves a real purpose.
    Justified { reason: Justification },
    /// Remove this comment — it is unnecessary.
    Unnecessary { reason: UnnecessaryKind },
}
