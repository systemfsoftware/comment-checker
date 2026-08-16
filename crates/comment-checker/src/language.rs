//! Map file paths and extensions to the tree-sitter language used to parse them.

use tree_sitter::Language;

/// The canonical language name for a file path, if this tool supports it.
#[must_use]
pub fn language_name_for_path(file_path: &str) -> Option<&'static str> {
    let extension = extension_or_basename(file_path)?;
    language_name_for_extension(extension)
}

/// The canonical language name for a bare extension, if supported.
#[must_use]
pub fn language_name_for_extension(extension: &str) -> Option<&'static str> {
    language_name_for_alias(extension.trim_start_matches('.'))
}

/// Load the compiled tree-sitter [`Language`] for a canonical name.
#[must_use]
pub fn language_for_name(name: &str) -> Option<Language> {
    tree_sitter_language_pack::get_language(name).ok()
}

fn language_name_for_alias(extension: &str) -> Option<&'static str> {
    match extension {
        "py" | "pyi" | "pyw" => Some("python"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "ts" => Some("typescript"),
        "tsx" => Some("tsx"),
        "go" => Some("go"),
        "rs" => Some("rust"),
        "c" | "h" => Some("c"),
        "cc" | "cpp" | "cxx" | "hpp" | "hh" => Some("cpp"),
        "java" => Some("java"),
        "kt" | "kts" => Some("kotlin"),
        "scala" | "sc" => Some("scala"),
        "rb" => Some("ruby"),
        "php" => Some("php"),
        "swift" => Some("swift"),
        "cs" => Some("csharp"),
        "ex" | "exs" => Some("elixir"),
        "sh" | "bash" | "zsh" => Some("bash"),
        "lua" => Some("lua"),
        "sql" => Some("sql"),
        "json" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "toml" => Some("toml"),
        "html" | "htm" => Some("html"),
        "css" => Some("css"),
        "dockerfile" => Some("dockerfile"),
        "hcl" | "tf" => Some("hcl"),
        "md" | "markdown" => Some("markdown"),
        "r" | "rmd" => Some("r"),
        "dart" => Some("dart"),
        "zig" => Some("zig"),
        "hs" => Some("haskell"),
        "ml" | "mli" => Some("ocaml"),
        "svelte" => Some("svelte"),
        "elm" => Some("elm"),
        "groovy" | "gradle" => Some("groovy"),
        "cue" => Some("cue"),
        "proto" => Some("proto"),
        _ => None,
    }
}

/// The file extension, or the whole basename when there is no extension
/// (Dockerfile, Makefile, …).
fn extension_or_basename(file_path: &str) -> Option<&str> {
    let basename = file_path.rsplit('/').next().unwrap_or(file_path);
    basename
        .rsplit_once('.')
        .filter(|(_, ext)| !ext.is_empty())
        .map(|(_, ext)| ext)
        .or_else(|| (!basename.is_empty()).then_some(basename))
}
