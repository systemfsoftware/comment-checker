//! Shared evaluation corpus and helpers (used by the F1 gate).
//!
//! The corpus is loaded from `eval/corpus.json` — the single source of truth
//! (CONST-E1). Each case carries a kind-level ground-truth label plus the
//! structural context (adjacent code, position, scope) the classifier needs,
//! so the gate exercises the real parse → detect → classify path against
//! context-bearing code, not comment text in isolation.
#![allow(dead_code)]

use std::collections::BTreeMap;

use claude_code_comment_checker::classify::classify;
use claude_code_comment_checker::detect::detect_comments;
use claude_code_comment_checker::{
    Comment, CommentType, Justification, PositionRole, Scope, UnnecessaryKind, Verdict,
};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Label {
    Unnecessary,
    Justified,
}

/// A single evaluation case, loaded from the canonical corpus JSON.
pub struct Case {
    pub text: String,
    /// The code this comment annotates, as the detector should capture it.
    pub code: String,
    pub position: PositionRole,
    pub scope: Scope,
    pub language: String,
    pub comment_type: CommentKind,
    /// Ground-truth kind: the specific `Justification`/`UnnecessaryKind` name.
    pub kind: String,
    pub label: Label,
}

#[derive(Deserialize)]
struct RawCase {
    text: String,
    code: String,
    position: String,
    scope: String,
    language: String,
    comment_type: String,
    kind: String,
}

fn parse_position(value: &str) -> PositionRole {
    match value {
        "docstring-head" => PositionRole::DocstringHead,
        "leading" => PositionRole::Leading,
        "trailing" => PositionRole::Trailing,
        "inline" => PositionRole::Inline,
        other => panic!("unknown position: {other}"),
    }
}

fn parse_scope(value: &str) -> Scope {
    match value {
        "module" => Scope::Module,
        "function" => Scope::Function,
        "nested" => Scope::NestedBlock,
        other => panic!("unknown scope: {other}"),
    }
}

/// Parse a corpus JSON document. Separated from [`load_corpus`] so malformed
/// input can be tested without touching the canonical file.
pub fn parse_corpus(json: &str) -> Vec<Case> {
    let raw: Vec<RawCase> =
        serde_json::from_str(json).expect("corpus JSON must parse as a case array");
    raw.into_iter()
        .map(|r| {
            let label = kind_label(&r.kind);
            Case {
                text: r.text,
                code: r.code,
                position: parse_position(&r.position),
                scope: parse_scope(&r.scope),
                language: r.language,
                comment_type: parse_comment_type(&r.comment_type),
                kind: r.kind,
                label,
            }
        })
        .collect()
}

fn parse_comment_type(value: &str) -> CommentKind {
    match value {
        "line" => CommentKind::Line,
        "block" => CommentKind::Block,
        "docstring" => CommentKind::Docstring,
        other => panic!("unknown comment_type: {other}"),
    }
}

/// The syntactic form of a comment, in the corpus vocabulary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommentKind {
    Line,
    Block,
    Docstring,
}

impl CommentKind {
    pub fn comment_type(self) -> CommentType {
        match self {
            CommentKind::Line => CommentType::Line,
            CommentKind::Block => CommentType::Block,
            CommentKind::Docstring => CommentType::Docstring,
        }
    }
}

/// Load the canonical corpus from `eval/corpus.json`.
pub fn load_corpus() -> Vec<Case> {
    parse_corpus(include_str!("../../../../eval/corpus.json"))
}

/// Binary label (justified vs unnecessary) for a kind name.
pub fn kind_label(kind: &str) -> Label {
    match kind {
        "Shebang" | "LicenseHeader" | "GeneratedFile" | "LinterDirective" | "BddStep"
        | "PublicApiDoc" | "NonObviousIntent" | "Attribution" => Label::Justified,
        "AgentMemo"
        | "CommentedOutCode"
        | "VacuousTodo"
        | "NarratesControlFlow"
        | "RestatesCode" => Label::Unnecessary,
        other => panic!("unknown kind: {other}"),
    }
}

/// Classify a case's text in isolation (no structural context) — the text-only
/// floor, which must hold wherever context is unreliable.
pub fn predict(case: &Case) -> Verdict {
    let comment = Comment::new(case.text.clone(), 1, case.comment_type.comment_type());
    classify(&comment)
}

/// Wrap a case's comment and its authored adjacent code in the smallest
/// snippet that parses in its language with the comment in the position the
/// case describes, so the gate exercises the real parse → detect → classify
/// path with context-bearing code.
pub fn synthesize_source(case: &Case) -> String {
    let text = case.text.as_str();
    let code = case.code.as_str();
    if case.comment_type == CommentKind::Docstring {
        return match case.language.as_str() {
            // Python docstrings live at the head of a module or body.
            "python" if case.scope == Scope::Module => format!("{text}\n{code}\n"),
            "python" => format!("def f():\n    {text}\n    {code}\n"),
            // Java doc comments must sit inside a class body.
            "java" => format!("class A {{\n{text}\n{code}\n}}\n"),
            // Brace languages: the doc comment precedes the declaration.
            "typescript" | "javascript" | "rust" => format!("{text}\n{code}\n"),
            "go" => format!("package main\n\n{text}\n{code}\n"),
            other => panic!("no docstring snippet for language: {other}"),
        };
    }
    match (case.position, case.scope) {
        (PositionRole::Leading | PositionRole::DocstringHead, Scope::Function) => {
            match case.language.as_str() {
                "python" => format!("def f():\n    {text}\n    {code}\n"),
                _ => format!("{text}\n{code}\n"),
            }
        }
        (PositionRole::Leading | PositionRole::DocstringHead, _) => format!("{text}\n{code}\n"),
        (PositionRole::Trailing, _) => format!("{code}\n{text}\n"),
        (PositionRole::Inline, _) => format!("{code} {text}\n"),
    }
}

/// The file name the synthesized snippet should be parsed as.
pub fn synthesized_path(case: &Case) -> String {
    format!("case.{}", ext_for_language(case.language.as_str()))
}

/// Classify a case through the production pipeline: parse the synthesized
/// snippet, detect its comments, and classify the one this case describes.
///
/// `None` means detection did not find the comment at all — a detector defect,
/// which the gate reports rather than silently scoring as a miss.
pub fn predict_detected(case: &Case) -> Option<Verdict> {
    let source = synthesize_source(case);
    let path = synthesized_path(case);
    let detected = detect_comments(&source, &path);
    let wanted = case.text.trim();
    let matched = detected
        .iter()
        .find(|c| c.text.trim() == wanted)
        .or_else(|| detected.iter().find(|c| c.text.contains(wanted)))
        .or_else(|| {
            // Grammars may normalize interior whitespace in multi-line comments.
            let first_line = wanted.lines().next().unwrap_or(wanted).trim();
            detected.iter().find(|c| c.text.contains(first_line))
        })?;
    Some(classify(matched))
}

/// The kind name a verdict assigns (mirrors the corpus `kind` vocabulary).
pub fn verdict_kind(verdict: &Verdict) -> &'static str {
    match verdict {
        Verdict::Justified { reason } => match reason {
            Justification::Shebang => "Shebang",
            Justification::LicenseHeader => "LicenseHeader",
            Justification::GeneratedFile => "GeneratedFile",
            Justification::LinterDirective => "LinterDirective",
            Justification::BddStep => "BddStep",
            Justification::PublicApiDoc => "PublicApiDoc",
            Justification::NonObviousIntent => "NonObviousIntent",
            Justification::Attribution => "Attribution",
        },
        Verdict::Unnecessary { reason } => match reason {
            UnnecessaryKind::AgentMemo => "AgentMemo",
            UnnecessaryKind::CommentedOutCode => "CommentedOutCode",
            UnnecessaryKind::VacuousTodo => "VacuousTodo",
            UnnecessaryKind::NarratesControlFlow { .. } => "NarratesControlFlow",
            UnnecessaryKind::RestatesCode { .. } => "RestatesCode",
        },
    }
}

/// Binary label a verdict assigns.
pub fn verdict_label(verdict: &Verdict) -> Label {
    match verdict {
        Verdict::Justified { .. } => Label::Justified,
        Verdict::Unnecessary { .. } => Label::Unnecessary,
    }
}

pub fn ext_for_language(language: &str) -> &'static str {
    match language {
        "python" => "py",
        "bash" => "sh",
        "typescript" => "ts",
        "javascript" => "js",
        "go" => "go",
        "rust" => "rs",
        "ruby" => "rb",
        "java" => "java",
        _ => "txt",
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct F1 {
    pub precision: f64,
    pub recall: f64,
    pub score: f64,
}

/// Per-kind and per-language breakdown plus the overall F1.
#[derive(Debug, Default)]
pub struct EvalReport {
    pub overall: F1,
    pub by_kind: BTreeMap<String, KindMetrics>,
    pub by_language: BTreeMap<String, LangMetrics>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct KindMetrics {
    /// How many corpus cases carry this ground-truth kind.
    pub actual: u32,
    /// How many cases the classifier assigned this kind.
    pub predicted: u32,
    /// How many cases both carry and were assigned this kind.
    pub correct: u32,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LangMetrics {
    pub tp: u32,
    pub fp: u32,
    pub fn_count: u32,
}

/// Evaluate the classifier over the corpus: overall F1, per-kind, per-language.
pub fn evaluate(corpus: &[Case], verdicts: &[Verdict]) -> EvalReport {
    let mut report = EvalReport::default();
    let mut tp = 0u32;
    let mut fp = 0u32;
    let mut fn_count = 0u32;

    for (case, verdict) in corpus.iter().zip(verdicts) {
        let got_label = verdict_label(verdict);
        match (case.label, got_label) {
            (Label::Unnecessary, Label::Unnecessary) => tp += 1,
            (Label::Justified, Label::Unnecessary) => fp += 1,
            (Label::Unnecessary, Label::Justified) => fn_count += 1,
            (Label::Justified, Label::Justified) => {}
        }

        let got_kind = verdict_kind(verdict);
        // Ground-truth bucket independent of the prediction, so recall has a
        // denominator; the predicted bucket counts assignments.
        let actual_k = report.by_kind.entry(case.kind.clone()).or_default();
        actual_k.actual += 1;
        let k = report.by_kind.entry(got_kind.to_owned()).or_default();
        k.predicted += 1;
        if case.kind == got_kind {
            k.correct += 1;
        }

        let lang = report.by_language.entry(case.language.clone()).or_default();
        match (case.label, got_label) {
            (Label::Unnecessary, Label::Unnecessary) => lang.tp += 1,
            (Label::Justified, Label::Unnecessary) => lang.fp += 1,
            (Label::Unnecessary, Label::Justified) => lang.fn_count += 1,
            (Label::Justified, Label::Justified) => {}
        }
    }

    let precision = f64::from(tp) / f64::from(tp + fp);
    let recall = f64::from(tp) / f64::from(tp + fn_count);
    let score = 2.0 * precision * recall / (precision + recall);
    report.overall = F1 {
        precision,
        recall,
        score,
    };
    report
}

/// The per-kind floor: any kind with at least `MIN_BUCKET` cases must reach
/// `MIN_KIND_PRECISION` precision and `MIN_KIND_RECALL` recall, so a weak kind
/// cannot hide inside the aggregate F1. Returns one violation string per
/// failing kind.
///
/// `context_dependent` names kinds whose detection only exists with structural
/// context (e.g. flow narration); on the text-only path they correctly degrade
/// to another kind, so their floors are not asserted there.
pub fn per_kind_violations(report: &EvalReport, context_dependent: &[&str]) -> Vec<String> {
    let mut violations = Vec::new();
    for (kind, m) in &report.by_kind {
        if m.actual < MIN_BUCKET || context_dependent.contains(&kind.as_str()) {
            continue;
        }
        let precision =
            f64::from(m.correct) / f64::from(if m.predicted == 0 { 1 } else { m.predicted });
        let recall = f64::from(m.correct) / f64::from(m.actual);
        if precision < MIN_KIND_PRECISION {
            violations.push(format!(
                "kind `{kind}` precision {precision:.3} < {MIN_KIND_PRECISION} (predicted {}, correct {})",
                m.predicted, m.correct
            ));
        }
        if recall < MIN_KIND_RECALL {
            violations.push(format!(
                "kind `{kind}` recall {recall:.3} < {MIN_KIND_RECALL} (actual {}, correct {})",
                m.actual, m.correct
            ));
        }
    }
    violations
}

pub const MIN_BUCKET: u32 = 2;
pub const MIN_KIND_PRECISION: f64 = 0.5;
pub const MIN_KIND_RECALL: f64 = 0.5;
