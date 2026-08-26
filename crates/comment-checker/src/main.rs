//! The `comment-checker` binary: a Claude Code `PostToolUse` hook.

use std::io::Read;
use std::process::ExitCode;

use clap::Parser;
use claude_code_comment_checker::hook::decode;
use claude_code_comment_checker::{Outcome, check, check_source, format_strip_report, plan_strip};

/// A hook that flags unnecessary code comments.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    /// Replace the default warning message; `{{comments}}` inserts the report.
    #[arg(long)]
    prompt: Option<String>,
    /// Delete whole-line flagged comments from the file named in the payload.
    ///
    /// Trailing and inline comments are reported, not cut. A missing file is
    /// report-only, same as without this flag.
    #[arg(long)]
    strip: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let prompt = cli.prompt.as_deref().unwrap_or_default();

    if cli.strip {
        run_strip(&input, prompt)
    } else {
        emit_outcome(check(&input, prompt))
    }
}

fn emit_outcome(outcome: Outcome) -> ExitCode {
    match outcome {
        Outcome::Pass { note } => {
            emit_to_debug_log(&note);
            ExitCode::from(0)
        }
        Outcome::Block { report, .. } => {
            emit_to_model(&report);
            ExitCode::from(2)
        }
    }
}

fn run_strip(input: &str, prompt: &str) -> ExitCode {
    let Some(hook) = decode(input) else {
        return emit_outcome(check(input, prompt));
    };
    let file_path = hook.tool_input.file_path.as_str();
    if file_path.is_empty() {
        return emit_outcome(check(input, prompt));
    }
    let Ok(on_disk) = std::fs::read_to_string(file_path) else {
        return emit_outcome(check(input, prompt));
    };

    match check_source(file_path, &on_disk, prompt) {
        Outcome::Pass { note } => {
            emit_to_debug_log(&note);
            ExitCode::from(0)
        }
        Outcome::Block { findings, .. } => {
            let plan = plan_strip(&on_disk, &findings);
            if plan.changed() {
                if let Err(err) = std::fs::write(file_path, &plan.source) {
                    emit_to_model(&format!(
                        "comment-checker --strip could not write {file_path}: {err}\n"
                    ));
                    return ExitCode::from(2);
                }
            }
            let remaining = match check_source(file_path, &plan.source, prompt) {
                Outcome::Pass { .. } => Vec::new(),
                Outcome::Block { findings, .. } => findings,
            };
            let report = format_strip_report(file_path, &plan.deleted, &remaining, prompt);
            if report.is_empty() {
                emit_to_debug_log("[check-comments] Skipping: No unnecessary comments found\n");
                return ExitCode::from(0);
            }
            emit_to_model(&report);
            ExitCode::from(2)
        }
    }
}

fn emit_to_model(report: &str) {
    eprint!("{report}");
}

fn emit_to_debug_log(note: &str) {
    print!("{note}");
}
