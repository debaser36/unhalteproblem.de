{ pkgs ? import <nixpkgs> { }, 
  lib ? pkgs.lib,
  stdenv ? pkgs.stdenv, 
  nodejs ? pkgs.nodejs_23, 
  pnpm ? pkgs.pnpm_10
}:

stdenv.mkDerivation rec {
  pname = "unhalteproblem-website";
  version = "0.0.1";
  src = ../..;
  
  nativeBuildInputs = [
    nodejs
    pnpm
  ];

  # Replace the __noChroot approach with fetchDeps
  pnpmDeps = pnpm.fetchDeps {
    inherit pname version src;
    # Replace this hash with the one you generated
		hash = "sha256-pB46Yqa9ZcjT5pzzyeQxH0WrEm/aRXibV5whMiROYpo=";
  };
  
  buildPhase = ''
    export HOME=$TMPDIR
    
    # Use the pre-fetched dependencies
    export PNPM_STORE_DIR=${pnpmDeps}/store
    
    echo "Working directory: $(pwd)"
    echo "Node.js version: $(node --version)"
    echo "pnpm version: $(pnpm --version)"
    
    # Install dependencies from the local store - offline mode
    pnpm install --frozen-lockfile --offline
    
    # Navigate to the web service and build
    cd services/web
    pnpm run build
  '';
  
  installPhase = ''
    mkdir -p $out
    cp -r dist/* $out
  '';
}
