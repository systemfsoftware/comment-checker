//! Shape the warning report (CONST-B3: shape is pure).

use crate::comment::{Comment, PositionRole, UnnecessaryKind};

/// A comment the classifier marked unnecessary, kept for the report.
#[derive(Clone, Debug)]
pub struct Flagged<'a> {
    pub comment: &'a Comment,
    pub kind: UnnecessaryKind,
}

/// An owned flagged comment the shell can strip or reprint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Finding {
    pub line_number: usize,
    pub text: String,
    pub reason: String,
    pub position: Option<PositionRole>,
}

#[must_use]
pub fn format_report(flagged: &[Flagged<'_>], file_path: &str, custom_prompt: &str) -> String {
    let header = format!(
        "An automated reviewer flagged {} comment(s) in {file_path} as unnecessary.",
        flagged.len()
    );
    let mut lines = vec![
        header,
        String::new(),
        "Each is stated with the specific reason it should be removed. Do not".to_string(),
        "dismiss these as \"justified\" — the reason is given so the claim can be".to_string(),
        "checked, not argued away.".to_string(),
        String::new(),
    ];
    for flag in flagged {
        lines.push(format!(
            "  line {} — {} — {}",
            flag.comment.line_number,
            flag.comment.text.trim(),
            reason_text(&flag.kind),
        ));
    }
    lines.push(String::new());
    lines.push("Action: delete the flagged comments. If the code is unclear without".to_string());
    lines.push(
        "one, make the code self-explanatory instead — better names, extraction,".to_string(),
    );
    lines.push("a clearer type — and do not re-add the comment.".to_string());
    apply_prompt(lines.join("\n"), custom_prompt)
}

/// Residual message after `--strip`: what was deleted, and what still needs a rewrite.
#[must_use]
pub fn format_strip_report(
    file_path: &str,
    deleted: &[Finding],
    remaining: &[Finding],
    custom_prompt: &str,
) -> String {
    let mut lines = Vec::new();
    if !deleted.is_empty() {
        lines.push(format!(
            "Deleted {} comment(s) from {file_path}. The code has to carry that meaning now:",
            deleted.len()
        ));
        for finding in deleted {
            let first = finding.text.lines().next().unwrap_or("").trim();
            lines.push(format!("  was: {first} — {}", finding.reason));
        }
        lines.push(String::new());
        lines.push(
            "Do this: rename the identifiers, extract the expression, or tighten the type until the deleted text would be redundant.".to_string(),
        );
    }
    if !remaining.is_empty() {
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.push(format!(
            "{} comment(s) in {file_path} need a rewrite rather than a cut (trailing or inline):",
            remaining.len()
        ));
        for finding in remaining {
            let first = finding.text.lines().next().unwrap_or("").trim();
            lines.push(format!(
                "  line {} — {first} — {}",
                finding.line_number, finding.reason
            ));
        }
        lines.push(String::new());
        lines.push(
            "Do this: change those lines so the comment has nothing left to state.".to_string(),
        );
    }
    if lines.is_empty() {
        return String::new();
    }
    apply_prompt(format!("{}\n", lines.join("\n")), custom_prompt)
}

fn apply_prompt(report: String, custom_prompt: &str) -> String {
    if custom_prompt.is_empty() {
        report
    } else {
        custom_prompt.replace("{{comments}}", &report)
    }
}

pub(crate) fn reason_text(kind: &UnnecessaryKind) -> String {
    match kind {
        UnnecessaryKind::NarratesControlFlow { construct, .. } => {
            format!("narrates the {construct} construct the code already shows")
        }
        UnnecessaryKind::RestatesCode { evidence } => {
            let mut reason = "restates what the code already says".to_owned();
            if !evidence.is_empty() {
                let mut parts = Vec::new();
                if !evidence.lexical.is_empty() {
                    parts.push(format!("shares {}", evidence.lexical.join(", ")));
                }
                for (verb, op) in &evidence.operator {
                    parts.push(format!("{verb} ↔ {op}"));
                }
                reason = format!("{reason} ({})", parts.join("; "));
            }
            reason
        }
        UnnecessaryKind::AgentMemo => {
            "describes what changed, not why — git history already records this".to_owned()
        }
        UnnecessaryKind::CommentedOutCode => "dead code left in a comment".to_owned(),
        UnnecessaryKind::VacuousTodo => {
            "a TODO with no tracked reference — file a ticket or delete it".to_owned()
        }
    }
}
