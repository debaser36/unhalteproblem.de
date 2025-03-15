{
  description = "Flake for unhalteproblem.de website and services";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs";

  outputs = { self, nixpkgs }: 
    let 
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in {
      packages = forAllSystems (system:
        let 
          pkgs = import nixpkgs { inherit system; };
          src = ./.;
          pnpmDeps = pkgs.pnpm.fetchDeps {
            pname = "unhalteproblem-website";
            version = "0.0.1";
            src = src;
            hash = "sha256-95op+Lebn95TDlihUs6kTdl2rSXEEOy47Qnmsa8bgHk="; # Auto-update this!
          };
        in {
          default = pkgs.callPackage ./services/web/default.nix { inherit pnpmDeps; };
        }
      );
    };
}
