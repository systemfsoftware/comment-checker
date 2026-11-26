{
  description = "comment-checker dev shell: Rust + JS toolchain, no ad-hoc installs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # The shared release toolchain. Its own nixpkgs stays its own: the apps it
    # builds assert the pnpm version its lockfile was resolved with.
    pnpm-release-management.url = "github:systemfsoftware/pnpm-release-management";
  };

  outputs = { self, nixpkgs, rust-overlay, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      linuxSystems = [ "x86_64-linux" "aarch64-linux" ];
      packagesFor = system: import nixpkgs {
        inherit system;
        overlays = [ (import rust-overlay) ];
      };
      forEachSystem = f: lib.genAttrs systems (system: f (packagesFor system));
      version = "0.3.7";
      # tree-sitter-language-pack's build.rs downloads a parser-sources
      # tarball at compile time; the nix sandbox has no network, so the
      # bundle rides in as a hash-pinned fetchurl (like Cargo.lock —
      # drift fails the build loudly). Keep tslpVersion equal to the
      # tree-sitter-language-pack version in Cargo.lock, and tslpSha256
      # equal to this tarball's real hash. TSLP_SOURCE_BUNDLE_URL also
      # accepts file://, which is how the sandboxed build reads it.
      tslpVersion = "1.20.0";
      tslpSha256 = "381b9ed7a781f822e43d3b3c8c5d030e3335f19f9c8eb7015b6a6f35a930ea54";
      tslpParserSources = pkgs: pkgs.fetchurl {
        url = "https://github.com/xberg-io/tree-sitter-language-pack/releases/download/v${tslpVersion}/parser-sources-${tslpVersion}.tar.zst";
        sha256 = tslpSha256;
      };
      # Source build: no fetchurl of the released *binary*, so no binary hash
      # to go stale (that fixed-output caching was the #81 failure).
      #
      # The toolchain pin is the repo's own: rust-toolchain.toml, from rust-overlay.
      mkCommentChecker = pkgs:
        let
          toolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          rustPlatform = pkgs.makeRustPlatform { cargo = toolchain; rustc = toolchain; };
          # build.rs (as of 1.20.0) refuses a bundle without a `<url>.sha256`
          # sidecar beside it; write one from the same pinned digest.
          tslpBundle = pkgs.runCommand "tslp-parser-sources-${tslpVersion}" { } ''
            mkdir $out
            ln -s ${tslpParserSources pkgs} $out/parser-sources.tar.zst
            echo ${tslpSha256} > $out/parser-sources.tar.zst.sha256
          '';
        in rustPlatform.buildRustPackage {
          pname = "comment-checker";
          inherit version;
          src = lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              (type == "directory") ||
              (builtins.elem (baseNameOf path) [ "Cargo.toml" "Cargo.lock" ]) ||
              (builtins.match ".*/.cargo/.*" path != null) ||
              (builtins.match ".*/crates/.*" path != null);
          };
          cargoLock.lockFile = ./Cargo.lock;
          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.zstd ];
          # The repo's quality gates (cargo test, mutation) run in CI, not in
          # this derivation; doCheck defaults to true in buildRustPackage and
          # would run the whole suite inside the nix sandbox.
          doCheck = false;
          TSLP_SOURCE_BUNDLE_URL = "file://${tslpBundle}/parser-sources.tar.zst";
          # cargo defaults CARGO_HOME to $HOME/.cargo. Without a sandbox
          # nix's HOME=/homeless-shelter is the real host path,
          # so the build would create it and every later rebuild would fail
          # nix's purity check. Keep cargo's home inside the build directory.
          preBuild = ''
            export HOME="$TMPDIR/home"
          '';
          meta = with lib; {
            description = "Claude Code PostToolUse hook that flags unnecessary comments";
            homepage = "https://github.com/systemfsoftware/comment-checker";
            license = licenses.asl20;
            platforms = platforms.unix;
            mainProgram = "comment-checker";
          };
        };

      # A working directory reaches the sandbox only when every character is in
      # `[A-Za-z0-9_/.-]`, because SBPL has no escape syntax: a crafted `$PWD`
      # could otherwise close the `(subpath "...")` string and append grants of
      # its own. `/` and `$HOME` are refused for the same reason on Linux, where
      # read-only there means the whole filesystem or the whole home directory, and
      # an empty `$PWD` is refused so bwrap is never handed an empty bind. The hook
      # reads its payload on stdin, so a refused directory costs file reads, never
      # the check itself.
      cwdGuard = ''
        safe_cwd() {
          case "$1" in
            "" | / | "$HOME" | "''${HOME%/}") return 1 ;;
            *[!A-Za-z0-9_/.-]*)
              echo "comment-checker: no read access for a working directory outside [A-Za-z0-9_/.-]: $1" >&2
              return 1
              ;;
          esac
          return 0
        }
        refuse_cwd() {
          echo "comment-checker: refusing to run: working directory '$1' is not a plain path in [A-Za-z0-9_/.-]" >&2
          exit 1
        }
      '';

      # Seatbelt baseline: (deny default) plus the minimum a native binary needs to
      # exec (dyld shared cache, libSystem, mach lookups, the inherited TTY).
      # Network stays denied by the default rule.
      seatbelt = pkgs: pkgs.writeText "comment-checker.sb" ''
        (version 1)
        (deny default)
        (allow process-fork)
        (allow process-exec)
        (allow signal (target same-sandbox))
        (allow sysctl-read)
        (allow file-read-metadata)
        (allow mach-lookup
            (global-name "com.apple.system.notification_center")
            (global-name "com.apple.system.logger")
            (global-name "com.apple.distributed_notifications@Uv3")
            (global-name "com.apple.CoreServices.coreservicesd")
            (global-name "com.apple.FSEvents"))
        (allow file-read-data (literal "/"))
        (allow file-read*
            (subpath "/nix")
            (subpath "/usr/lib")
            (subpath "/usr/share")
            (subpath "/System")
            (subpath "/Library")
            (subpath "/private/etc")
            (subpath "/private/var/db/dyld")
            (subpath "/private/var/db/timezone"))
        (allow file-map-executable (subpath "/nix"))
        (allow file-read* (subpath "/dev/fd"))
        (allow file-read* file-write* file-ioctl
            (literal "/dev/tty")
            (regex #"^/dev/ttys[0-9]+$"))
        (allow file-read* file-write*
            (literal "/dev/null")
            (literal "/dev/zero")
            (literal "/dev/random")
            (literal "/dev/urandom"))
      '';

      # The one sandbox builder. `binary` is the executable the wrapper runs;
      # `cwdMode` selects whether an unsafe working directory is refused
      # ("required") or simply left unreadable ("optional"). The default package
      # and the conformance probe are both built through this function so the
      # sandbox flags cannot drift between what ships and what CI proves.
      #
      # Linux: no /proc, /etc, /usr or /lib bind. The evaluation derivation
      # patchelfs, so the binary resolves its loader and libc from /nix/store;
      # mounting procfs is refused on hosts that forbid it, and passing the host
      # environment through would hand every secret to the tool.
      mkSandbox = pkgs: { name, binary, cwdMode }:
        let
          requireCwd = cwdMode == "required";
          linuxCwd = if requireCwd then ''
            real="$(pwd -P)"
            safe_cwd "$real" || refuse_cwd "$real"
            binds=(--ro-bind "$real" "$real" --chdir "$real")
          '' else ''
            real="$(pwd -P)"
            binds=()
            safe_cwd "$real" && binds=(--ro-bind "$real" "$real" --chdir "$real")
          '';
          darwinCwd = if requireCwd then ''
            real="$(pwd -P)"
            safe_cwd "$real" || refuse_cwd "$real"
            cwdRules=" (subpath \"$real\")"
          '' else ''
            real="$(pwd -P)"
            cwdRules=""
            safe_cwd "$real" && cwdRules=" (subpath \"$real\")"
          '';
        in
        if pkgs.stdenv.hostPlatform.isLinux then
          pkgs.writeShellScriptBin name ''
            ${cwdGuard}
            ${linuxCwd}
            exec ${pkgs.bubblewrap}/bin/bwrap \
              --ro-bind /nix/store /nix/store \
              --dev /dev --tmpfs /tmp \
              --unshare-all --new-session --clearenv --die-with-parent \
              "''${binds[@]}" \
              -- ${binary} "$@"
          ''
        else if pkgs.stdenv.hostPlatform.isDarwin then
          pkgs.writeShellScriptBin name ''
            ${cwdGuard}
            ${darwinCwd}
            profile=$(cat ${seatbelt pkgs})
            [ -n "$cwdRules" ] && profile="$profile
            (allow file-read*$cwdRules)"
            err=$(mktemp "''${TMPDIR:-/tmp}/${name}.XXXXXX")
            trap 'rm -f "$err"' EXIT INT TERM
            /usr/bin/env -i /usr/bin/sandbox-exec -p "$profile" -- ${binary} "$@" 2>"$err"
            status=$?
            grep -vF 'sandbox-exec is deprecated' "$err" >&2
            exit $status
          ''
        else
          throw "${name}: no sandbox for ${pkgs.stdenv.hostPlatform.system}";

      # The probe that proves the sandbox, run once unwrapped and once through
      # mkSandbox by scripts/sandbox-conformance.sh.
      probe = pkgs: pkgs.writeShellScriptBin "sandbox-probe" (builtins.readFile ./nix/sandbox-probe.sh);
    in
    {
      # workspace-tarballs (plus one attribute per public pnpm member) is what
      # the shared release workflow packs and tags; the pnpm it builds with must
      # equal package.json's packageManager pin. The npm packaging is a Linux CI
      # concern, so it is exported only there.
      packages = forEachSystem (pkgs:
        let
          unwrapped = mkCommentChecker pkgs;
          sandboxed = mkSandbox pkgs {
            name = "comment-checker";
            binary = "${unwrapped}/bin/comment-checker";
            cwdMode = "optional";
          };
          own = {
            comment-checker = sandboxed;
            comment-checker-unwrapped = unwrapped;
            default = sandboxed;
          };
        in
        own // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux (
          let
            workspace = pnpm-release-management.lib.mkPnpmWorkspacePackages {
              inherit pkgs;
              src = self;
              pname = "comment-checker";
              pnpm = pkgs.pnpm_11;
            };
          in
          workspace));

      checks = forEachSystem (pkgs:
        let
          raw = probe pkgs;
        in
        {
          sandbox-probe-raw = raw;
          sandbox-probe = mkSandbox pkgs {
            name = "sandbox-probe";
            binary = "${raw}/bin/sandbox-probe";
            cwdMode = "optional";
          };
        });

      devShells = lib.genAttrs linuxSystems (system:
        let
          pkgs = packagesFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml)
              pkgs.cargo-mutants
              pkgs.gcc
              pkgs.nodejs
              pkgs.pnpm_11
              pkgs.zstd
              pkgs.actionlint
              (mkSandbox pkgs {
                name = "comment-checker";
                binary = "${mkCommentChecker pkgs}/bin/comment-checker";
                cwdMode = "optional";
              })
              # github-release-management, version-management, changeset-management:
              # the shared release workflow runs them through `nix develop`.
              pnpm-release-management.packages.${pkgs.stdenv.hostPlatform.system}.release-tools
            ];
            # stdenv exports LD_FOR_BUILD, and Deno refuses to spawn under a
            # scoped --allow-run while any LD_*/DYLD_* var is set, which breaks
            # every scripts/tools/*.ts that shells out (tar, …).
            #
            # tree-sitter-language-pack 1.20.0's build.rs never finds its own
            # OUT_DIR cache when TSLP_LANGUAGES is set, so it re-downloads and
            # re-extracts the bundle on every run, which marks it dirty again:
            # every cargo command recompiles all grammars. A pre-extracted
            # bundle at PROJECT_ROOT short-circuits that. Export it only when
            # Cargo.lock names the pinned version: a stale PROJECT_ROOT would
            # compile another release's grammar sources without complaint.
            shellHook = ''
              unset LD_FOR_BUILD
              unset PROJECT_ROOT
              tslp_locked=$(awk '$0 == "name = \"tree-sitter-language-pack\"" { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock 2>/dev/null)
              if [ "$tslp_locked" = "${tslpVersion}" ]; then
                tslp_root="''${XDG_CACHE_HOME:-$HOME/.cache}/comment-checker/tslp-${tslpVersion}"
                if [ ! -f "$tslp_root/parsers/python/src/parser.c" ]; then
                  rm -rf "$tslp_root.tmp" && mkdir -p "$tslp_root.tmp" \
                    && tar --zstd -xf ${tslpParserSources pkgs} -C "$tslp_root.tmp" \
                    && rm -rf "$tslp_root" && mv "$tslp_root.tmp" "$tslp_root"
                fi
                [ -f "$tslp_root/parsers/python/src/parser.c" ] && export PROJECT_ROOT="$tslp_root"
              else
                echo "comment-checker devShell: Cargo.lock has tree-sitter-language-pack ''${tslp_locked:-?}, flake.nix pins ${tslpVersion}; grammar builds fall back to per-build downloads" >&2
              fi
            '';
          };
        });
    };
}
