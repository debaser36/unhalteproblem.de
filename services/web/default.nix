{pkgs ? import <nixpkgs> { }, stdenv ? pkgs.stdenv, nodejs ? pkgs.nodejs_23, pnpm ? pkgs.pnpm_10, pnpmDeps ? null, ...}:
stdenv.mkDerivation (finalAttrs: {
  pname = "unhalteproblem-website";
  version = "0.0.1";
  src = ./.;
  buildInputs = [
    nodejs
    pnpm
  ];
  inherit pnpmDeps;
  buildPhase = ''
      pnpm install --frozen-lockfile
      pnpm run build
    '';
  installPhase = ''
      mkdir -p $out
      cp -r dist/* $out
    '';
})
 
 