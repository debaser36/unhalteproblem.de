# NixOS module for the unhalteproblem.de backend.
#
# Runs the backend image (packages.backend-image of this flake) with
# virtualisation.oci-containers, published on 127.0.0.1 only, and optionally
# routes https://<virtualHost>/api/ to it through nginx. Usage in the server's
# flake:
#
#   inputs.unhalteproblem.url = "github:debaser36/unhalteproblem.de";
#   modules = [
#     inputs.unhalteproblem.nixosModules.backend
#     {
#       services.unhalteproblem-backend = {
#         enable = true;
#         nginx.virtualHost = "unhalteproblem.de";
#       };
#     }
#   ];
#
# The image is built for the server's own platform and loaded on every
# `nixos-rebuild switch`, so there is no registry and no manual `docker load`.
self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.unhalteproblem-backend;
  image = self.packages.${pkgs.stdenv.hostPlatform.system}.backend-image;

  proxyConfig = ''
    # Overwrite, never append: the backend rate-limits by this header.
    proxy_set_header X-Real-IP $remote_addr;
    # Same limit as the backend's MaxBodySize, so oversized requests get a
    # clean 413 here instead of a dropped connection there.
    client_max_body_size 32k;
  '';
in
{
  options.services.unhalteproblem-backend = {
    enable = lib.mkEnableOption "the unhalteproblem.de backend container";

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = ''
        Port on 127.0.0.1 that the container is published on. Only local
        clients (nginx) can reach it, which is what makes the X-Real-IP
        header trustworthy for rate limiting.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        CONTACT_RATE_LIMIT = "5";
        CONTACT_RATE_LIMIT_WINDOW = "1 hour";
      };
      description = ''
        Extra environment variables for the backend (see
        services/backend/README.md). HOST, PORT and LOG_FORMAT are set by the
        image.
      '';
    };

    nginx.virtualHost = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "unhalteproblem.de";
      description = ''
        nginx virtual host that gets a /api/ location proxying to the backend
        (the /api prefix is stripped). The virtual host itself (TLS, root) is
        configured elsewhere. null leaves nginx alone.
      '';
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      virtualisation.oci-containers.containers.unhalteproblem-backend = {
        image = "${image.imageName}:${image.imageTag}";
        imageFile = image;
        ports = [ "127.0.0.1:${toString cfg.port}:3000" ];
        inherit (cfg) environment;
        extraOptions = [
          "--read-only"
          "--cap-drop=ALL"
          "--security-opt=no-new-privileges"
          "--memory=256m"
        ];
      };
    }

    (lib.mkIf (cfg.nginx.virtualHost != null) {
      # A first, fixed-size line of defence in front of the backend's own
      # limiter: 1 MB of state (about 16k addresses, oldest evicted first).
      services.nginx.appendHttpConfig = ''
        limit_req_zone $binary_remote_addr zone=unhalteproblem_contact:1m rate=6r/m;
      '';

      services.nginx.virtualHosts.${cfg.nginx.virtualHost}.locations = {
        "/api/" = {
          # The trailing slash strips the /api prefix: /api/health -> /health.
          proxyPass = "http://127.0.0.1:${toString cfg.port}/";
          extraConfig = proxyConfig;
        };
        "= /api/contact" = {
          proxyPass = "http://127.0.0.1:${toString cfg.port}/contact";
          extraConfig = proxyConfig + ''
            limit_req zone=unhalteproblem_contact burst=5 nodelay;
            limit_req_status 429;
          '';
        };
      };
    })
  ]);
}
