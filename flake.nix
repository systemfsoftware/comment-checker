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
      version = "0.3.2";
      # Source build: no fetchurl of the released *binary*, so no binary hash
      # to go stale (that fixed-output caching was the #81 failure).
      #
      # The toolchain pin is the repo's own: rust-toolchain.toml, from rust-overlay.
      mkCommentChecker = pkgs:
        let
          toolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          rustPlatform = pkgs.makeRustPlatform { cargo = toolchain; rustc = toolchain; };
          # tree-sitter-language-pack's build.rs downloads a parser-sources
          # tarball at compile time; the nix sandbox has no network, so the
          # bundle rides in as a hash-pinned fetchurl (like Cargo.lock —
          # drift fails the build loudly). Keep the URL version equal to the
          # tree-sitter-language-pack version in Cargo.lock, and the sha256
          # equal to this tarball's real hash. TSLP_SOURCE_BUNDLE_URL also
          # accepts file://, which is how the sandboxed build reads it.
          tslpParserSources = pkgs.fetchurl {
            url = "https://github.com/xberg-io/tree-sitter-language-pack/releases/download/v1.14.3/parser-sources-1.14.3.tar.zst";
            sha256 = "f13bcf0be1b9a99c45ead43671ae311346c2a10807c3fdc7c76407445ea7f2c7";
          };
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
          TSLP_SOURCE_BUNDLE_URL = "file://${tslpParserSources}";
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
            (mkBwrap pkgs (mkCommentChecker pkgs))
          ];
        };
      });
    };
}
