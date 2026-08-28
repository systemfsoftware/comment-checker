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
      mkCommentChecker = pkgs:
        let
          target = {
            "x86_64-linux" = "x86_64-unknown-linux-gnu";
            "aarch64-linux" = "aarch64-unknown-linux-gnu";
            "x86_64-darwin" = "x86_64-apple-darwin";
            "aarch64-darwin" = "aarch64-apple-darwin";
          }.${pkgs.system} or (throw "unsupported system ${pkgs.system}");
          hash = {
            "x86_64-unknown-linux-gnu" = "sha256-d/Xl2VZqnB+lFNkdtglY7N/nY6CxhgQG+arGL7FmCME=";
            "aarch64-unknown-linux-gnu" = "sha256-vP0Ss8eOOElpCrxryGiMn0WMBIEDtJe3LnB8FunZjok=";
            "x86_64-apple-darwin" = "sha256-c0mJOCcz0Zt61Da/y/n3JTFGchWJQk8cBZ8EMVYx7e8=";
            "aarch64-apple-darwin" = "sha256-C/f81qw86DXoZ6dL2rEt6z67IfYw09hG8iaa0vQOu2U=";
          }.${target};
          src = pkgs.fetchurl {
            url = "https://github.com/systemfsoftware/comment-checker/releases/download/v${version}/comment-checker-${target}";
            inherit hash;
          };
        in pkgs.stdenv.mkDerivation {
          pname = "comment-checker";
          inherit version src;
          dontUnpack = true;
          installPhase = ''
            install -Dm755 $src $out/bin/comment-checker
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
            (mkBwrap pkgs (mkCommentChecker pkgs))
          ];
        };
      });
    };
}
