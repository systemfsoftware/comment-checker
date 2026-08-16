//! The F1 gate (CONST-E1): the classifier must reach F1 ≥ 0.85 on the
//! kind-labeled, context-bearing corpus, with a printed per-kind and
//! per-language confusion matrix plus asserted per-kind precision/recall
//! floors, so a weak kind cannot hide inside the aggregate.

mod common;

use claude_code_comment_checker::{
    CommentType, Justification, PositionRole, RestateEvidence, Scope, UnnecessaryKind, Verdict,
};
use common::{
    Case, Label, evaluate, load_corpus, parse_corpus, per_kind_violations, predict,
    predict_detected,
};

/// Every corpus case must survive the production path: parse a snippet in its
/// language with its authored context, find the comment, classify it. This is
/// the gate that fails when a grammar bump silently turns detection off — the
/// text-only gate below cannot see detector defects at all.
#[test]
fn every_case_is_detectable_end_to_end() {
    let corpus = load_corpus();
    let mut undetectable = Vec::new();
    for case in &corpus {
        if predict_detected(case).is_none() {
            undetectable.push((case.language.clone(), case.text.clone()));
        }
    }
    assert!(
        undetectable.is_empty(),
        "{} corpus cases were not detected end-to-end:\n{}",
        undetectable.len(),
        undetectable
            .iter()
            .map(|(lang, text)| format!("  [{lang}] {text:?}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// The F1 floor and per-kind floors, measured through the production path so
/// context-aware rules are actually exercised.
#[test]
fn detected_path_reaches_f1_threshold() {
    let corpus = load_corpus();
    let verdicts: Vec<_> = corpus
        .iter()
        .map(|case| {
            predict_detected(case)
                .unwrap_or_else(|| panic!("case not detected: [{}] {:?}", case.language, case.text))
        })
        .collect();
    // The gate must also see the context wiring: at least one restatement
    // verdict has to carry cited evidence drawn from the detected adjacency,
    // or a detector that silently drops adjacent_code would alias through.
    let cited_restates = verdicts
        .iter()
        .filter_map(|v| match v {
            Verdict::Unnecessary {
                reason: UnnecessaryKind::RestatesCode { evidence },
            } => (!evidence.is_empty()).then_some(()),
            _ => None,
        })
        .count();
    assert!(
        cited_restates >= 1,
        "no detected-path restatement verdict cited evidence; context wiring is broken"
    );
    run_gate("detected path", &corpus, &verdicts, &[]);
}

/// The same floors on the text-only path — the floor that must hold wherever
/// structural context is unreliable (Edit/MultiEdit fragments).
#[test]
fn classifier_reaches_f1_threshold() {
    let corpus = load_corpus();
    let verdicts: Vec<_> = corpus.iter().map(predict).collect();
    // NarratesControlFlow only exists with structural context; on the
    // text-only path it degrades to RestatesCode by design, so its floor is
    // asserted on the detected path only.
    run_gate(
        "text-only path",
        &corpus,
        &verdicts,
        &["NarratesControlFlow"],
    );
}

fn run_gate(name: &str, corpus: &[Case], verdicts: &[Verdict], context_dependent: &[&str]) {
    let report = evaluate(corpus, verdicts);
    eprintln!("=== {name} ===");
    eprintln!(
        "=== overall: precision {:.3}, recall {:.3}, F1 {:.3} ===",
        report.overall.precision, report.overall.recall, report.overall.score
    );
    eprintln!("=== per-kind (correct / actual / predicted) ===");
    for (kind, m) in &report.by_kind {
        eprintln!(
            "  {kind}: {}/{} actual {} predicted (precision {:.3}, recall {:.3})",
            m.correct,
            m.actual,
            m.predicted,
            m.precision(),
            m.recall()
        );
    }
    eprintln!("=== per-language (tp/fp/fn) ===");
    for (lang, m) in &report.by_language {
        if m.tp + m.fp + m.fn_count == 0 {
            eprintln!("  {lang}: no unnecessary cases");
            continue;
        }
        let precision = f64::from(m.tp) / f64::from(m.tp + m.fp);
        let recall = f64::from(m.tp) / f64::from(m.tp + m.fn_count);
        eprintln!(
            "  {lang}: tp {} fp {} fn {} (precision {precision:.3}, recall {recall:.3})",
            m.tp, m.fp, m.fn_count
        );
    }

    assert!(
        report.overall.score >= 0.85,
        "{name} F1 = {:.3} (precision {:.3}, recall {:.3})",
        report.overall.score,
        report.overall.precision,
        report.overall.recall
    );

    let violations = per_kind_violations(&report, context_dependent);
    assert!(
        violations.is_empty(),
        "per-kind floor violations on the {name}:\n{}",
        violations.join("\n")
    );
}

/// Malformed corpus JSON, unknown position, or unknown scope must fail loudly
/// at load, never silently score zero.
#[test]
fn malformed_corpus_fails_loudly() {
    assert!(
        std::panic::catch_unwind(|| parse_corpus("this is not json")).is_err(),
        "malformed corpus must panic"
    );
    assert!(
        std::panic::catch_unwind(|| {
            parse_corpus(
                r##"[{"text":"# x","code":"x = 1","position":"sideways","scope":"module","language":"python","comment_type":"line","kind":"RestatesCode"}]"##,
            )
        })
        .is_err(),
        "unknown position must panic"
    );
    assert!(
        std::panic::catch_unwind(|| {
            parse_corpus(
                r##"[{"text":"# x","code":"x = 1","position":"leading","scope":"orbit","language":"python","comment_type":"line","kind":"RestatesCode"}]"##,
            )
        })
        .is_err(),
        "unknown scope must panic"
    );
}

/// A kind with zero cases reports gracefully — no floor assertion fires and
/// there is no division by zero.
#[test]
fn zero_case_kind_reports_gracefully() {
    let report = evaluate(&[], &[]);
    assert!(report.by_kind.is_empty());
    assert!(per_kind_violations(&report, &[]).is_empty());
}

/// The per-kind floor must trip on a kind-level regression even when the
/// overall F1 stays ≥ 0.85 — a weak kind must not hide inside the average.
#[test]
fn per_kind_floor_catches_kind_level_regression() {
    let mut corpus: Vec<Case> = (0..10)
        .map(|_| synthetic_case("AgentMemo", Label::Unnecessary))
        .collect();
    corpus.extend((0..3).map(|_| synthetic_case("RestatesCode", Label::Unnecessary)));

    let mut verdicts: Vec<Verdict> = (0..10)
        .map(|_| Verdict::Unnecessary {
            reason: UnnecessaryKind::AgentMemo,
        })
        .collect();
    // Two of the three restatement cases are kept (mis-justified): the kind's
    // recall collapses while the overall F1 stays high on the AgentMemo pool.
    verdicts.extend([
        Verdict::Unnecessary {
            reason: UnnecessaryKind::RestatesCode {
                evidence: RestateEvidence::default(),
            },
        },
        Verdict::Justified {
            reason: Justification::NonObviousIntent,
        },
        Verdict::Justified {
            reason: Justification::NonObviousIntent,
        },
    ]);

    let report = evaluate(&corpus, &verdicts);
    assert!(
        report.overall.score >= 0.85,
        "scenario requires overall F1 ≥ 0.85 (was {:.3})",
        report.overall.score
    );
    let violations = per_kind_violations(&report, &[]);
    assert!(
        violations.iter().any(|v| v.contains("RestatesCode")),
        "floor must flag the RestatesCode regression; got {violations:?}"
    );
}

fn synthetic_case(kind: &str, label: Label) -> Case {
    Case {
        text: "synthetic".into(),
        code: "x = 1".into(),
        position: PositionRole::Leading,
        scope: Scope::Module,
        language: "python".into(),
        comment_type: CommentType::Line,
        kind: kind.into(),
        label,
    }
}
