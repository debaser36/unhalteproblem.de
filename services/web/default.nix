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
		pkgs.cacert
  ];

  # This is crucial for network access
  __noChroot = true;
  
  buildPhase = ''
    export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export HOME=$TMPDIR
    export HOME=$TMPDIR
    echo "Working directory: $(pwd)"
    echo "Node.js version: $(node --version)"
    echo "pnpm version: $(pnpm --version)"
    
    # Install dependencies with network access
    pnpm install --frozen-lockfile
    
    # Navigate to the web service and build
    cd services/web
    pnpm run build
  '';
  
  installPhase = ''
    mkdir -p $out
    cp -r dist/* $out
  '';
  
  # This helps with debugging
  shellHook = ''
    echo "Development environment ready!"
    echo "Node.js: $(node --version)"
    echo "pnpm: $(pnpm --version)"
  '';
}
