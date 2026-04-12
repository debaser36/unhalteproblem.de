{
  description = "Monorepo flake with pnpm + Node.js 25";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
				pnpm = pkgs.pnpm.override {nodejs = pkgs.nodejs_25;};
      in
      {
        # -----------------
        # DEV SHELL
        # -----------------
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_25
            pnpm
          ];

          shellHook = ''
            if [ -z "$FISH_VERSION" ] && ps -p $PPID -o comm= | grep -q fish; then
              exec ${pkgs.fish}/bin/fish
            fi
          '';
        };

        # -----------------
        # BUILD PACKAGE
        # -----------------
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "unhalteproblem.de";
          version = "0.1.0";

          src = ./.;

          nativeBuildInputs = with pkgs; [
            nodejs_25
            pnpm
          ];

          # Ensures reproducibility
          PNPM_STORE_DIR = "/build/pnpm-store";

          buildPhase = ''
            export HOME=$TMPDIR

            pnpm install --frozen-lockfile
            pnpm -r build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r . $out/
          '';
        };
      }
    );
}
