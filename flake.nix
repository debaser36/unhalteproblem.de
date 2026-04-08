{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShellNoCC {
  name = "dev@unhalteproblem.de";
  packages = with pkgs; [ 
    nodejs_25
    pnpm
  ];

  shellHook = ''
    echo "lets get started"
  '';
}