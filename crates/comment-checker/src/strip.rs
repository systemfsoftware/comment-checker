//! Pure strip of whole-line flagged comments (CONST-B1: no I/O).

use crate::comment::PositionRole;
use crate::report::Finding;

/// Rewritten source plus which findings were cut versus left for a rewrite.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StripPlan {
    pub source: String,
    pub deleted: Vec<Finding>,
    pub remaining: Vec<Finding>,
}

impl StripPlan {
    #[must_use]
    pub fn changed(&self) -> bool {
        !self.deleted.is_empty()
    }
}

/// Remove whole-line flagged comments from `source`.
///
/// A finding is cut only when its text equals the occupied source lines
/// (trimmed) and its position is not trailing or inline. Shebang lines are
/// never cut. Everything else stays in `remaining`.
///
/// Line endings in `source` are preserved (`\r\n` vs `\n`). Comment markers
/// are not interpreted here: occupancy comes from the finding's own source
/// text, which tree-sitter already extracted for that language.
#[must_use]
pub fn plan_strip(source: &str, findings: &[Finding]) -> StripPlan {
    let ending = line_ending(source);
    let lines: Vec<&str> = source.lines().collect();
    let mut cut = vec![false; lines.len()];
    let mut deleted = Vec::new();
    let mut remaining = Vec::new();

    for finding in findings {
        match occupied_whole_lines(&lines, finding) {
            Some(indices) => {
                for index in indices {
                    cut[index] = true;
                }
                deleted.push(finding.clone());
            }
            None => remaining.push(finding.clone()),
        }
    }

    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| if cut[index] { None } else { Some(*line) })
        .collect();
    let mut rewritten = kept.join(ending);
    if source.ends_with('\n') && (rewritten.is_empty() || !rewritten.ends_with(ending)) {
        rewritten.push_str(ending);
    }

    StripPlan {
        source: rewritten,
        deleted,
        remaining,
    }
}

fn line_ending(source: &str) -> &'static str {
    if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn occupied_whole_lines(lines: &[&str], finding: &Finding) -> Option<Vec<usize>> {
    if matches!(
        finding.position,
        Some(PositionRole::Trailing | PositionRole::Inline)
    ) {
        return None;
    }
    let comment_lines: Vec<&str> = finding.text.split('\n').collect();
    let start = finding.line_number.checked_sub(1)?;
    if start == 0 && lines.first().is_some_and(|line| line.starts_with("#!")) {
        return None;
    }
    if start + comment_lines.len() > lines.len() {
        return None;
    }
    for (offset, comment_line) in comment_lines.iter().enumerate() {
        if lines[start + offset].trim() != comment_line.trim() {
            return None;
        }
    }
    Some(
        (0..comment_lines.len())
            .map(|offset| start + offset)
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Outcome;
    use crate::check::check_source;
    use crate::comment::PositionRole;

    fn finding(line: usize, text: &str, position: Option<PositionRole>) -> Finding {
        Finding {
            line_number: line,
            text: text.to_owned(),
            reason: "restates what the code already says".to_owned(),
            position,
        }
    }

    #[test]
    fn cuts_a_whole_line_comment_and_keeps_the_code() {
        let source = "def load(path):\n    # Parse the config file\n    return path\n";
        let plan = plan_strip(
            source,
            &[finding(
                2,
                "# Parse the config file",
                Some(PositionRole::Leading),
            )],
        );
        assert_eq!(plan.source, "def load(path):\n    return path\n");
        assert_eq!(plan.deleted.len(), 1);
        assert!(plan.remaining.is_empty());
    }

    #[test]
    fn leaves_a_trailing_comment_in_place() {
        let source = "x = 1  # TODO: fix this later\n";
        let plan = plan_strip(
            source,
            &[finding(
                1,
                "# TODO: fix this later",
                Some(PositionRole::Trailing),
            )],
        );
        assert_eq!(plan.source, source);
        assert!(plan.deleted.is_empty());
        assert_eq!(plan.remaining.len(), 1);
    }

    #[test]
    fn leaves_a_mismatched_line_in_place_without_position() {
        let source = "x = 1  # TODO: fix this later\n";
        let plan = plan_strip(source, &[finding(1, "# TODO: fix this later", None)]);
        assert_eq!(plan.source, source);
        assert!(plan.deleted.is_empty());
    }

    #[test]
    fn never_cuts_a_shebang() {
        let source = "#!/usr/bin/env python3\nx = 1\n";
        let plan = plan_strip(source, &[finding(1, "#!/usr/bin/env python3", None)]);
        assert_eq!(plan.source, source);
        assert!(plan.deleted.is_empty());
    }

    #[test]
    fn preserves_a_missing_trailing_newline() {
        let source = "x = 1\n# TODO: fix this later";
        let plan = plan_strip(
            source,
            &[finding(
                2,
                "# TODO: fix this later",
                Some(PositionRole::Leading),
            )],
        );
        assert_eq!(plan.source, "x = 1");
        assert!(!plan.source.ends_with('\n'));
    }

    #[test]
    fn preserves_crlf() {
        let source = "# TODO: fix this later\r\nx = 1\r\n";
        let plan = plan_strip(
            source,
            &[finding(
                1,
                "# TODO: fix this later",
                Some(PositionRole::Leading),
            )],
        );
        assert_eq!(plan.source, "x = 1\r\n");
    }

    fn strip_source(path: &str, source: &str) -> String {
        let Outcome::Block { findings, .. } = check_source(path, source, "") else {
            panic!("{path}: expected a block, source was {source:?}");
        };
        plan_strip(source, &findings).source
    }

    #[test]
    fn strips_whole_line_todos_for_each_comment_family() {
        let cases = [
            ("a.py", "# TODO: fix this later\nx = 1\n", "x = 1\n"),
            ("a.js", "// TODO: fix this later\nx = 1\n", "x = 1\n"),
            ("a.ts", "// TODO: fix this later\nx = 1\n", "x = 1\n"),
            (
                "a.rs",
                "// TODO: fix this later\nlet x = 1;\n",
                "let x = 1;\n",
            ),
            ("a.go", "// TODO: fix this later\nx := 1\n", "x := 1\n"),
            (
                "a.c",
                "// TODO: fix this later\nint x = 1;\n",
                "int x = 1;\n",
            ),
            ("a.rb", "# TODO: fix this later\nx = 1\n", "x = 1\n"),
            ("a.sh", "# TODO: fix this later\nx=1\n", "x=1\n"),
            (
                "a.lua",
                "-- TODO: fix this later\nlocal x = 1\n",
                "local x = 1\n",
            ),
            (
                "a.sql",
                "-- TODO: fix this later\nSELECT 1;\n",
                "SELECT 1;\n",
            ),
            ("a.hs", "-- TODO: fix this later\nx = 1\n", "x = 1\n"),
            ("a.js", "/* TODO: fix this later */\nx = 1\n", "x = 1\n"),
            (
                "a.css",
                "/* TODO: fix this later */\nbody { color: red; }\n",
                "body { color: red; }\n",
            ),
            (
                "a.html",
                "<!-- TODO: fix this later -->\n<p>x</p>\n",
                "<p>x</p>\n",
            ),
        ];
        for (path, source, expected) in cases {
            assert_eq!(strip_source(path, source), expected, "{path}: {source:?}");
        }
    }

    #[test]
    fn strips_a_multiline_block_comment() {
        let source = "/* TODO: fix this later\nand also this */\nint x = 1;\n";
        assert_eq!(strip_source("a.c", source), "int x = 1;\n");
    }

    #[test]
    fn does_not_cut_jsx_wrapper_around_a_block_comment() {
        let source = "const x = 1;\n        {/* TODO: fix this later */}\n";
        let Outcome::Block { findings, .. } = check_source("a.tsx", source, "") else {
            return;
        };
        let plan = plan_strip(source, &findings);
        assert_eq!(plan.source, source);
    }
}
