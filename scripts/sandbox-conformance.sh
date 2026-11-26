#!/usr/bin/env bash
set -euo pipefail

system="${1:?usage: sandbox-conformance.sh <system>}"

out() { nix build --no-link --print-out-paths ".#$1"; }
sandboxed="$(out "packages.${system}.comment-checker")/bin/comment-checker"
unwrapped="$(out "packages.${system}.comment-checker-unwrapped")/bin/comment-checker"
probe_raw="$(out "checks.${system}.sandbox-probe-raw")/bin/sandbox-probe"
probe_boxed="$(out "checks.${system}.sandbox-probe")/bin/sandbox-probe"

work="$(mktemp -d)"
canary="$(mktemp "${HOME:?HOME is unset}/comment-checker.canary.XXXXXX")"
portfile="$work/port"
python3 - "$portfile" <<'PY' &
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 0))
s.listen(8)
with open(sys.argv[1], "w") as f:
    f.write(str(s.getsockname()[1]))
while True:
    conn, _ = s.accept()
    conn.close()
PY
listener=$!
cleanup() { kill "$listener" 2>/dev/null || true; rm -rf "$work"; rm -f "$canary"; }
trap cleanup EXIT
until [ -s "$portfile" ]; do sleep 0.1; done
port="$(cat "$portfile")"

cd "$work"
printf 'export const x = 1;\n' > a.ts

fail() { echo "sandbox conformance: FAIL: $*" >&2; exit 1; }
expect_line() {
  local out="$1" line="$2"
  grep -qxF "$line" <<<"$out" || fail "expected '$line' in: $(tr '\n' ' ' <<<"$out")"
}

control="$(SANDBOX_PROBE_SECRET=leak "$probe_raw" "$canary" "$port")"
expect_line "$control" NET_OK
expect_line "$control" CANARY_READ_OK
expect_line "$control" 'SECRET=[leak]'
expect_line "$control" CWD_WRITABLE
expect_line "$control" ETC_READ_OK
expect_line "$control" USR_READ_OK
rm -f .sandbox-probe-write

boxed="$(SANDBOX_PROBE_SECRET=leak "$probe_boxed" "$canary" "$port")"
expect_line "$boxed" NET_DENIED
expect_line "$boxed" CANARY_READ_DENIED
expect_line "$boxed" 'SECRET=[]'
expect_line "$boxed" CWD_READONLY
expect_line "$boxed" USR_READ_DENIED
[ ! -e .sandbox-probe-write ] || fail "the sandbox wrote into the working directory"

if [ "$system" = "x86_64-linux" ] || [ "$system" = "aarch64-linux" ]; then
  expect_line "$control" PROC_READ_OK
  expect_line "$boxed" ETC_READ_DENIED
  expect_line "$boxed" PROC_READ_DENIED
fi

set +e
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"a.ts","content":"export const x = 1;\n"}}' \
  | "$sandboxed" > clean.out 2> clean.err
clean_rc=$?
set -e
[ "$clean_rc" -eq 0 ] || fail "a clean payload exited $clean_rc, want 0"
[ ! -s clean.err ] || fail "a clean payload wrote to stderr"
grep -q 'No unnecessary comments found' clean.out || fail "a clean payload did not report the skip on stdout"

payload='{"tool_name":"Write","tool_input":{"file_path":"src/math.ts","content":"// increment counter\ncounter += 1;\n"}}'
set +e
printf '%s' "$payload" | "$sandboxed" > box.out 2> box.err; box_rc=$?
printf '%s' "$payload" | "$unwrapped" > raw.out 2> raw.err; raw_rc=$?
set -e
[ "$box_rc" -eq 2 ] || fail "a flagged payload exited $box_rc through the sandbox, want 2"
[ "$raw_rc" -eq 2 ] || fail "a flagged payload exited $raw_rc unwrapped, want 2"
cmp -s box.err raw.err || fail "the sandboxed stderr differs from the unwrapped stderr"
cmp -s box.out raw.out || fail "the sandboxed stdout differs from the unwrapped stdout"

unsafe="$work/a directory"
mkdir -p "$unsafe"
set +e
(cd "$unsafe" && printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"a.ts","content":"export const x = 1;\n"}}' \
  | "$sandboxed" > "$work/unsafe.out" 2> "$work/unsafe.err")
unsafe_rc=$?
set -e
[ "$unsafe_rc" -eq 0 ] || fail "comment-checker must still check stdin from an unsafe working directory (exit $unsafe_rc)"
grep -q 'No unnecessary comments found' "$work/unsafe.out" \
  || fail "comment-checker did not check stdin from an unsafe working directory"

linked="$work/linked"
ln -s "$HOME" "$linked"
set +e
(cd "$linked" && printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"a.ts","content":"export const x = 1;\n"}}' \
  | "$sandboxed" > "$work/link.out" 2> "$work/link.err")
link_rc=$?
set -e
[ "$link_rc" -eq 0 ] || fail "comment-checker must still check stdin from a symlinked home directory (exit $link_rc)"
grep -q 'No unnecessary comments found' "$work/link.out" || fail "comment-checker failed from a symlinked home directory"

set +e
(cd / && "$sandboxed" --version > "$work/root.out" 2> "$work/root.err")
root_rc=$?
set -e
[ "$root_rc" -eq 0 ] || fail "the shipped wrapper must report its version from / (exit $root_rc)"
grep -q 'claude-code-comment-checker' "$work/root.out" || fail "the shipped wrapper did not print its version from /"

echo "sandbox conformance: ok ($system)"
