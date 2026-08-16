//! Decode the Claude Code hook payload (CONST-B5: decode, never cast).

use serde::Deserialize;

/// The JSON Claude Code sends to a `PostToolUse` hook.
#[derive(Debug, Deserialize)]
pub struct HookInput {
    #[serde(default)]
    pub tool_name: String,
    #[serde(default)]
    pub tool_input: ToolInput,
}

/// The `tool_input` field: content differs by tool.
#[derive(Debug, Default, Deserialize)]
pub struct ToolInput {
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub new_string: String,
    #[serde(default)]
    pub old_string: String,
    #[serde(default)]
    pub edits: Vec<Edit>,
}

/// One edit in a `MultiEdit` payload.
#[derive(Debug, Deserialize)]
pub struct Edit {
    #[serde(default)]
    pub old_string: String,
    #[serde(default)]
    pub new_string: String,
}

/// Decode the raw hook JSON. Returns `None` on any malformed input, which the
/// caller treats as "skip" — a hook must never block the user on bad input.
#[must_use]
pub fn decode(input: &str) -> Option<HookInput> {
    serde_json::from_str(input).ok()
}
