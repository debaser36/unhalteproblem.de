{
  description = "Flake for unhalteproblem.de website and services";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs";

  outputs = { self, nixpkgs }: let
    pkgs = nixpkgs.legacyPackages.x86_64-linux;
    src = ./.;
    pnpmDeps = pkgs.pnpm.fetchDeps {
      pname = "unhalteproblem-website";
      version = "0.0.1";
      src = src;
      hash = "sha256-95op+Lebn95TDlihUs6kTdl2rSXEEOy47Qnmsa8bgHk="; # Auto-update this!
    };
  in {
    packages.x86_64-linux.default = pkgs.callPackage ./services/web/default.nix { inherit pnpmDeps; };
    packages.x86_64-darwin.default = pkgs.callPackage ./services/web/default.nix { inherit pnpmDeps; };
		packagees.aarch64-linux.default = pkgs.callPackage ./services/web/default.nix { inherit pnpmDeps; };
  };
}
