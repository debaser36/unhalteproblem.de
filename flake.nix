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

        # Only the files the builds need, so edits elsewhere
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

        # The builds have no network access, so the dependencies of the whole
        # workspace are fetched beforehand into one fixed-output derivation that
        # every package below shares. When pnpm-lock.yaml changes, set
        # hash = "", run `nix build` and copy the "got:" hash in here.
        pnpmDeps = pkgs.fetchPnpmDeps {
          pname = "unhalteproblem.de";
          version = "0.1.0";
          inherit src pnpm;
          fetcherVersion = 4;
          hash = "sha256-hDcKuTGo81l9xEdl1jMCz4i2vNa+zgpSOY5zwrRGdRU=";
        };

        # Builds one workspace package (and the workspace packages it depends
        # on) with the shared dependencies.
        buildWorkspacePackage = { pname, filter, installPhase }:
          pkgs.stdenv.mkDerivation {
            inherit pname src pnpmDeps;
            version = "0.1.0";

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
            ];

            buildPhase = ''
              runHook preBuild
              pnpm --filter "${filter}..." build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              ${installPhase}
              runHook postInstall
            '';
          };

        # The backend as a single bundled file (services/backend/dist/main.js).
        backend = buildWorkspacePackage {
          pname = "unhalteproblem-backend";
          filter = "@unhalteproblem.de/backend";
          installPhase = ''
            install -Dm444 services/backend/dist/main.js $out/lib/main.js
          '';
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
        # BUILD PACKAGES
        # -----------------
        # The static website (services/web/dist), served by nginx on nixos-oracle.
        packages.default = buildWorkspacePackage {
          pname = "unhalteproblem.de";
          filter = "@unhalteproblem.de/website";
          installPhase = ''
            cp -r services/web/dist $out
          '';
        };

        packages.backend = backend;

        # The backend's OCI image: Node and the bundle, nothing else (no shell,
        # no package manager). It runs as an unprivileged user and needs no
        # writable filesystem. The tag is derived from the contents, so every
        # change produces a new image. Load it with `docker load < result` or
        # let the NixOS module below do it.
        packages.backend-image = pkgs.dockerTools.buildLayeredImage {
          name = "unhalteproblem-backend";
          config = {
            Cmd = [
              "${pkgs.nodejs-slim_26}/bin/node"
              "${backend}/lib/main.js"
            ];
            Env = [
              "NODE_ENV=production"
              "HOST=0.0.0.0"
              "PORT=3000"
              "LOG_FORMAT=json"
            ];
            ExposedPorts."3000/tcp" = { };
            User = "65534:65534";
          };
        };
      }
    ) // {
      # NixOS module that runs the backend image with oci-containers behind
      # nginx. See nix/backend-module.nix for the options.
      nixosModules.backend = import ./nix/backend-module.nix self;
    };
}
