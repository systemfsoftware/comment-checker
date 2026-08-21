export const binaryFileName = (platform: string): string =>
  platform === "win32" ? "comment-checker.exe" : "comment-checker"

export const optionalDepName = (platform: string, arch: string): string =>
  `@systemfsoftware/claude-code-comment-checker-${platform}-${arch}`