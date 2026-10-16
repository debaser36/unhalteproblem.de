{
  description = "Monorepo flake with pnpm + Node.js 26";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;

        nodejs = pkgs.nodejs_26;
        # pnpm 12 matches "packageManager" in package.json
        pnpm = pkgs.pnpm_12.override { nodejs-slim = nodejs; };

        # Only the files the website build needs, so edits elsewhere
        # (docs, repos/, .claude/) do not trigger a rebuild.
        src = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            ./pnpm-lock.yaml
            ./pnpm-workspace.yaml
            ./lib
            ./services
          ];
        };
      in
      {
        # -----------------
        # DEV SHELL
        # -----------------
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
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
        # The static website (services/web/dist), served by nginx on nixos-oracle.
        packages.default = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "unhalteproblem.de";
          version = "0.1.0";

          inherit src;

          # The build has no network access, so the dependencies are fetched
          # beforehand into a fixed-output derivation. When pnpm-lock.yaml changes,
          # set hash = "", run `nix build` and copy the "got:" hash in here.
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            inherit pnpm;
            fetcherVersion = 4;
            hash = "sha256-hDcKuTGo81l9xEdl1jMCz4i2vNa+zgpSOY5zwrRGdRU=";
          };

          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.pnpmConfigHook
          ];

          buildPhase = ''
            runHook preBuild
            # The website and the workspace packages it depends on
            pnpm --filter "@unhalteproblem.de/website..." build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cp -r services/web/dist $out
            runHook postInstall
          '';
        });
      }
    );
}
