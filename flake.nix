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
        in {
          default = pkgs.callPackage ./services/web/default.nix { };
        }
      );
    };
}
