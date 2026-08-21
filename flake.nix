{
  description = "comment-checker dev shell: Rust + JS toolchain, no ad-hoc installs";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems
          (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            # Rust toolchain (rustc 1.97 — satisfies rust-version = 1.85).
            # rustc MUST be explicit: cargo resolves rustc via PATH, and a
            # dev shell without it silently borrows whatever rustc the host
            # happens to expose (on CI runners: the rustup proxy).
            cargo
            rustc
            clippy
            rustfmt
            cargo-mutants

            # Linker + C compiler: the cc crate compiles tree-sitter grammars.
            gcc

            # JS toolchain: nodejs 24 (CI major), pnpm pinned by nixpkgs to
            # 11.21.0 — identical to packageManager, so no corepack shim.
            nodejs
            pnpm
          ];
        };
      });
    };
}
