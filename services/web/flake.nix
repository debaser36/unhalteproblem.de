{
  description = "unhalteproblem.de Website for http/https";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: {
    packages.aarch64-linux.website = let
      pkgs = import nixpkgs { system = "aarch64-linux"; };
    in pkgs.stdenv.mkDerivation {
      pname = "unhalteproblem.de";
      version = "1.0";

      src = ./src;  # Path to your website source code

      buildInputs = [ pkgs.nodejs ];  # Adjust depending on what your website needs

      buildPhase = ''
        pnpm install
        pnpm run build  # Adjust this command to your build process
      '';

      installPhase = ''
        mkdir -p $out
        cp -r dist/* $out/ 
      '';
    };
  };
}

