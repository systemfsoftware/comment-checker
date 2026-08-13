//! Shared evaluation corpus and helpers (used by the F1 gate).
//!
//! The corpus is loaded from `eval/corpus.json` — the single source of truth
//! (CONST-E1). Each case carries a kind-level ground-truth label so the gate
//! can report per-kind and per-language precision/recall, not just one number.
#![allow(dead_code)]

use std::collections::BTreeMap;

use claude_code_comment_checker::classify::classify;
use claude_code_comment_checker::detect::detect_comments;
use claude_code_comment_checker::{Comment, CommentType, Justification, UnnecessaryKind, Verdict};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Label {
    Unnecessary,
    Justified,
}

/// A single evaluation case, loaded from the canonical corpus JSON.
pub struct Case {
    pub text: String,
    pub language: String,
    pub comment_type: CommentType,
    /// Ground-truth kind: the specific `Justification`/`UnnecessaryKind` name.
    pub kind: String,
    pub label: Label,
}

#[derive(Deserialize)]
struct RawCase {
    text: String,
    language: String,
    comment_type: String,
    kind: String,
}

/// Load the canonical corpus from `eval/corpus.json`.
pub fn load_corpus() -> Vec<Case> {
    let raw: Vec<RawCase> = serde_json::from_str(include_str!("../../../../eval/corpus.json"))
        .expect("eval/corpus.json must be valid JSON");
    raw.into_iter()
        .map(|r| {
            let comment_type = match r.comment_type.as_str() {
                "line" => CommentType::Line,
                "block" => CommentType::Block,
                "docstring" => CommentType::Docstring,
                other => panic!("unknown comment_type: {other}"),
            };
            let label = kind_label(&r.kind);
            Case {
                text: r.text,
                language: r.language,
                comment_type,
                kind: r.kind,
                label,
            }
        })
        .collect()
}

/// Binary label (justified vs unnecessary) for a kind name.
pub fn kind_label(kind: &str) -> Label {
    match kind {
        "Shebang" | "LicenseHeader" | "GeneratedFile" | "LinterDirective" | "BddStep"
        | "PublicApiDoc" | "NonObviousIntent" | "Attribution" => Label::Justified,
        "AgentMemo" | "CommentedOutCode" | "VacuousTodo" | "RestatesCode" => Label::Unnecessary,
        other => panic!("unknown kind: {other}"),
    }
}

/// Classify a case's text in isolation (no structural context).
pub fn predict(case: &Case) -> Verdict {
    let comment = Comment::new(case.text.clone(), 1, case.comment_type);
    classify(&comment)
}

/// A statement that parses on its own in `language`.
fn filler_statement(language: &str) -> &'static str {
    match language {
        "bash" => "x=1",
        "typescript" | "javascript" => "const x = 1;",
        "go" => "package main",
        "rust" => "pub fn f() {}",
        "java" => "class A { int x = 1; }",
        _ => "x = 1",
    }
}

/// Wrap a case's comment in the smallest snippet that parses in its language
/// and yields exactly that comment, so the gate can exercise the real
/// parse → detect → classify path instead of hand-building a `Comment`.
pub fn synthesize_source(case: &Case) -> String {
    let text = case.text.as_str();
    if case.comment_type == CommentType::Docstring {
        return match case.language.as_str() {
            // Python docstrings live at the head of a body.
            "python" => format!("def f():\n    {text}\n    return 1\n"),
            // Java doc comments must sit inside a class body.
            "java" => format!("class A {{\n{text}\nint f() {{ return 1; }}\n}}\n"),
            // Brace languages: the doc comment precedes the declaration.
            "typescript" | "javascript" => format!("{text}\nfunction f() {{}}\n"),
            "go" => format!("package main\n\n{text}\nfunc F() {{}}\n"),
            "rust" => format!("{text}\npub fn f() {{}}\n"),
            other => format!("{text}\n{}\n", filler_statement(other)),
        };
    }
    // Line and block comments lead an ordinary statement.
    format!("{text}\n{}\n", filler_statement(case.language.as_str()))
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
            UnnecessaryKind::RestatesCode => "RestatesCode",
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
    pub by_kind: BTreeMap<&'static str, KindMetrics>,
    pub by_language: BTreeMap<String, LangMetrics>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct KindMetrics {
    /// How many cases the classifier assigned this kind.
    pub predicted: u32,
    /// How many of those matched the ground-truth kind.
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
        let k = report.by_kind.entry(got_kind).or_default();
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
