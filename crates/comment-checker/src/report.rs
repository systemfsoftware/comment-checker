//! Shape the warning report (CONST-B3: shape is pure).

use crate::comment::{Comment, UnnecessaryKind};

/// A comment the classifier marked unnecessary, kept for the report.
#[derive(Clone, Copy, Debug)]
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
            reason_text(flag.kind),
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

fn reason_text(kind: UnnecessaryKind) -> &'static str {
    match kind {
        UnnecessaryKind::RestatesCode => "restates what the code already says",
        UnnecessaryKind::AgentMemo => {
            "describes what changed, not why — git history already records this"
        }
        UnnecessaryKind::CommentedOutCode => "dead code left in a comment",
        UnnecessaryKind::VacuousTodo => {
            "a TODO with no tracked reference — file a ticket or delete it"
        }
    }
}
