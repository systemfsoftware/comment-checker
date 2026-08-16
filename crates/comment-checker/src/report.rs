//! Shape the warning report (CONST-B3: shape is pure).

use crate::comment::{Comment, UnnecessaryKind};

/// A comment the classifier marked unnecessary, kept for the report.
#[derive(Clone, Debug)]
pub struct Flagged<'a> {
    pub comment: &'a Comment,
    pub kind: UnnecessaryKind,
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
    let report = lines.join("\n");
    if custom_prompt.is_empty() {
        report
    } else {
        custom_prompt.replace("{{comments}}", &report)
    }
}

fn reason_text(kind: &UnnecessaryKind) -> String {
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
