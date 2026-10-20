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
          hash = "sha256-+tWfLcA90HXKkup358tXWHXxvkmU5ZLMcCDVuTS9plU=";
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

        # The backend's OCI image: Node, the bundle and CA certificates, nothing
        # else (no shell, no package manager). It runs as an unprivileged user
        # and needs no writable filesystem. The tag is derived from the
        # contents, so every change produces a new image. Load it with
        # `docker load < result` or let the NixOS module below do it.
        packages.backend-image = pkgs.dockerTools.buildLayeredImage {
          name = "unhalteproblem-backend";
          # Node from nixpkgs verifies TLS against the system store in
          # /etc/ssl/certs, not its bundled roots; without it every HTTPS call
          # (Keycloak) fails with "unable to get local issuer certificate".
          contents = [ pkgs.dockerTools.caCertificates ];
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
            # The image has no shell or curl, so the probe is Node itself.
            # /ready also checks the database. An unhealthy container shows up
            # in `podman ps` (nothing restarts it for that alone). Durations
            # are in nanoseconds.
            #
            # Podman runs the first check the moment the container starts, as a
            # systemd unit; a failure then, while the backend is still
            # migrating, would make `nixos-rebuild switch` report a failed unit.
            # So the probe retries for 10 seconds (20 x 500 ms) before it fails,
            # and the timeout leaves room for that.
            Healthcheck = {
              Test = [
                "CMD"
                "${pkgs.nodejs-slim_26}/bin/node"
                "-e"
                "(async()=>{for(let i=0;i<20;i++){try{const r=await fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready');if(r.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)})()"
              ];
              Interval = 30000000000;
              Timeout = 15000000000;
              StartPeriod = 20000000000;
              Retries = 3;
            };
          };
        };
      }
    ) // {
      # NixOS module that runs the backend image with oci-containers behind
      # nginx. See nix/backend-module.nix for the options.
      nixosModules.backend = import ./nix/backend-module.nix self;
    };
}
