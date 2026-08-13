//! The F1 gate (CONST-E1): the classifier must reach F1 ≥ 0.85 on the
//! kind-labeled corpus, with per-kind and per-language visibility printed so a
//! weak kind or language cannot hide inside the aggregate.

mod common;

use common::{evaluate, load_corpus, predict, predict_detected, synthesize_source};

/// Every corpus case must survive the production path: parse a snippet in its
/// language, find the comment, classify it. This is the gate that fails when a
/// grammar bump silently turns detection off — the text-only gate below cannot
/// see detector defects at all.
#[test]
fn every_case_is_detectable_end_to_end() {
    let corpus = load_corpus();
    let mut undetected = Vec::new();
    for case in &corpus {
        if predict_detected(case).is_none() {
            undetected.push((case.language.clone(), case.text.clone()));
        }
    }
    assert!(
        undetected.is_empty(),
        "{} of {} corpus cases were not detected end-to-end:\n{}",
        undetected.len(),
        corpus.len(),
        undetected
            .iter()
            .map(|(lang, text)| format!(
                "  [{lang}] {text:?}\n    snippet: {:?}",
                synthesize_source(
                    corpus
                        .iter()
                        .find(|c| &c.text == text && &c.language == lang)
                        .expect("case round-trips")
                )
            ))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// The same F1 floor, measured through the production path so context-aware
/// rules are actually exercised.
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
    let report = evaluate(&corpus, &verdicts);

    eprintln!("=== detected-path per-kind (correct / predicted) ===");
    for (kind, m) in &report.by_kind {
        let precision = if m.predicted == 0 {
            1.0
        } else {
            f64::from(m.correct) / f64::from(m.predicted)
        };
        eprintln!(
            "  {kind}: {}/{} predicted (precision {precision:.3})",
            m.correct, m.predicted
        );
    }

    let f1 = report.overall;
    assert!(
        f1.score >= 0.85,
        "detected-path F1 = {:.3} (precision {:.3}, recall {:.3})",
        f1.score,
        f1.precision,
        f1.recall
    );
}

#[test]
fn classifier_reaches_f1_threshold() {
    let corpus = load_corpus();
    let verdicts: Vec<_> = corpus.iter().map(predict).collect();
    let report = evaluate(&corpus, &verdicts);

    eprintln!("=== per-kind (correct / predicted) ===");
    for (kind, m) in &report.by_kind {
        let precision = if m.predicted == 0 {
            1.0
        } else {
            f64::from(m.correct) / f64::from(m.predicted)
        };
        eprintln!(
            "  {kind}: {}/{} predicted (precision {precision:.3})",
            m.correct, m.predicted
        );
    }

    eprintln!("=== per-language (tp/fp/fn) ===");
    for (lang, m) in &report.by_language {
        let precision = f64::from(m.tp) / f64::from(m.tp + m.fp);
        let recall = f64::from(m.tp) / f64::from(m.tp + m.fn_count);
        eprintln!(
            "  {lang}: tp {} fp {} fn {} (precision {precision:.3}, recall {recall:.3})",
            m.tp, m.fp, m.fn_count
        );
    }

    let f1 = report.overall;
    assert!(
        f1.score >= 0.85,
        "F1 = {:.3} (precision {:.3}, recall {:.3})",
        f1.score,
        f1.precision,
        f1.recall
    );

    // Per-kind floor: any kind predicted at least `MIN_BUCKET` times must hit a
    // minimum precision/recall. Without a floor, a perfectly-recalled restate
    // count hides a kind that always falsely-convicts.
    let min_bucket: u32 = 3;
    let min_precision: f64 = 0.5;
    for (kind, m) in &report.by_kind {
        if m.predicted < min_bucket {
            continue;
        }
        let p = f64::from(m.correct) / f64::from(m.predicted);
        assert!(
            p >= min_precision,
            "kind `{kind}` precision {:.3} < {:.3} (predicted {}, correct {})",
            p,
            min_precision,
            m.predicted,
            m.correct
        );
    }
}
