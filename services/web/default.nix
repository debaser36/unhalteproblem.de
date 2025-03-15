{pkgs ? import <nixpkgs> { }, stdenv ? pkgs.stdenv, nodejs ? pkgs.nodejs_23, pnpm ? pkgs.pnpm_10,  ...}:
stdenv.mkDerivation (finalAttrs: {
  pname = "unhalteproblem-website";
  version = "0.0.1";
  src = ../..;
  buildInputs = [
    nodejs
    pnpm
  ];
  pnpmDeps = pnpm.fetchDeps {
		inherit (finalAttrs) pname version src;
		hash = "sha256-GhKqbEuLQHj7nul0FB7hCRRb4th+45pBQDy8Pn6JO7A=";
	};
  buildPhase = ''
      pnpm install --frozen-lockfile
      pnpm run build
    '';
  installPhase = ''
      mkdir -p $out
      cp -r dist/* $out
    '';
})
 
 
