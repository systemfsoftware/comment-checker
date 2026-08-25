//! The `comment-checker` binary: a Claude Code `PostToolUse` hook.

use std::io::Read;
use std::process::ExitCode;

use clap::Parser;
use claude_code_comment_checker::{Outcome, check};

/// A hook that flags unnecessary code comments.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    /// Replace the default warning message; `{{comments}}` inserts the report.
    #[arg(long)]
    prompt: Option<String>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);

    match check(&input, cli.prompt.as_deref().unwrap_or_default()) {
        Outcome::Pass { note } => {
            print!("{note}");
            ExitCode::from(0)
        }
        Outcome::Block { report } => {
            // Why: exit 2 hands the model stderr and drops the other stream.
            eprint!("{report}");
            ExitCode::from(2)
        }
    }
}
