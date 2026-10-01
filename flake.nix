{
  description = "comment-checker dev shell: Rust + JS toolchain, no ad-hoc installs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems
          (system:
            let
              pkgs = import nixpkgs {
                inherit system;
                overlays = [ (import rust-overlay) ];
              };
            in f pkgs);
      version = "0.3.6";
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
          src = nixpkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              (type == "directory") ||
              (builtins.elem (baseNameOf path) [ "Cargo.toml" "Cargo.lock" ]) ||
              (builtins.match ".*/.cargo/.*" path != null) ||
              (builtins.match ".*/crates/.*" path != null);
          };
          cargoLock.lockFile = ./Cargo.lock;
          # The repo's quality gates (cargo test, mutation) run in CI, not in
          # this derivation; doCheck defaults to true in buildRustPackage and
          # would run the whole suite inside the nix sandbox.
          doCheck = false;
          TSLP_SOURCE_BUNDLE_URL = "file://${tslpBundle}/parser-sources.tar.zst";
          # cargo defaults CARGO_HOME to $HOME/.cargo. Without a sandbox (the
          # macOS default) nix's HOME=/homeless-shelter is the real host path,
          # so the build would create it and every later rebuild would fail
          # nix's purity check. Keep cargo's home inside the build directory.
          preBuild = ''
            export HOME="$TMPDIR/home"
          '';
          meta = with pkgs.lib; {
            description = "Claude Code PostToolUse hook that flags unnecessary comments";
            homepage = "https://github.com/systemfsoftware/comment-checker";
            license = licenses.asl20;
            platforms = platforms.unix;
          };
        };
      mkBwrap = pkgs: commentChecker:
        pkgs.writeShellScriptBin "comment-checker" ''
          extra=""
          [ -e /lib ] && extra="$extra --ro-bind /lib /lib"
          [ -e /lib64 ] && extra="$extra --ro-bind /lib64 /lib64"
          exec ${pkgs.bubblewrap}/bin/bwrap \
            --ro-bind /nix/store /nix/store \
            --ro-bind /etc /etc \
            --ro-bind /usr /usr \
            $extra \
            --proc /proc --dev /dev --tmpfs /tmp \
            --unshare-net --die-with-parent \
            --ro-bind "$PWD" "$PWD" \
            --chdir "$PWD" \
            -- ${commentChecker}/bin/comment-checker "$@"
        '';
    in {
      packages = forAllSystems (pkgs:
        let
          unwrapped = mkCommentChecker pkgs;
          wrapped = mkBwrap pkgs unwrapped;
        in {
          comment-checker = unwrapped;
          comment-checker-bwrap = wrapped;
          default = wrapped;
        });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml)
            pkgs.cargo-mutants
            pkgs.gcc
            pkgs.nodejs
            pkgs.pnpm
            pkgs.bubblewrap
            pkgs.zstd
            (mkBwrap pkgs (mkCommentChecker pkgs))
          ];
          # stdenv exports LD_FOR_BUILD, and Deno refuses to spawn under a
          # scoped --allow-run while any LD_*/DYLD_* var is set, which breaks
          # every scripts/tools/*.ts that shells out (git, gh, docker, …).
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
