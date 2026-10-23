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
#         # Not secret, ends up in the Nix store.
#         environment = {
#           POSTGRES_HOST = "host.containers.internal";
#         };
#         # Secrets: a root-only file outside the Nix store with lines like
#         #   OIDC_CLIENT_SECRET=...
#         #   KEYCLOAK_ADMIN_CLIENT_SECRET=...
#         #   POSTGRES_PASSWORD=...
#         # e.g. config.sops.secrets.<name>.path (sops-nix) or
#         # config.age.secrets.<name>.path (agenix).
#         environmentFiles = [ "/run/secrets/unhalteproblem-backend.env" ];
#       };
#     }
#   ];
#
# The image is built for the server's own platform and loaded on every
# `nixos-rebuild switch`, so there is no registry and no manual `docker load`.
#
# Postgres is not set up here; the database must already exist (the backend
# creates its tables itself). The container has its own network namespace,
# so `localhost` inside it is the container, not the host. To reach a
# Postgres on the host with podman (the NixOS default backend, bridge
# podman0, subnet 10.88.0.0/16, host side 10.88.0.1):
#
#   services.unhalteproblem-backend.environment.POSTGRES_HOST =
#     "host.containers.internal";   # or "10.88.0.1"
#   # Listen on all interfaces; the firewall keeps 5432 closed except on the
#   # container bridge. (Listening only on 10.88.0.1 fails at boot, because
#   # podman creates the bridge after Postgres starts.)
#   services.postgresql.enableTCPIP = true;
#   services.postgresql.authentication = ''
#     host unhalteproblem unhalteproblem 10.88.0.0/16 scram-sha-256
#   '';
#   networking.firewall.interfaces.podman0.allowedTCPPorts = [ 5432 ];
#
# With docker instead, use the docker0 bridge (172.17.0.0/16, host side
# 172.17.0.1): POSTGRES_HOST = "172.17.0.1", the same pg_hba line for
# 172.17.0.0/16 and firewall.interfaces.docker0. Docker only knows
# host.docker.internal with an extra
#   virtualisation.oci-containers.containers.unhalteproblem-backend.extraOptions =
#     [ "--add-host=host.docker.internal:host-gateway" ];
# Never put POSTGRES_PASSWORD in `environment`; it belongs in environmentFiles.
self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.unhalteproblem-backend;
  image = self.packages.${pkgs.stdenv.hostPlatform.system}.backend-image;

  # Variables that must never be written to the world-readable Nix store.
  secretVariables = [
    "OIDC_CLIENT_SECRET"
    "KEYCLOAK_ADMIN_CLIENT_SECRET"
    "POSTGRES_PASSWORD"
    "SMTP_PASSWORD"
    "ANTHROPIC_API_KEY"
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET"
  ];

  # Restores a dump into a scratch database and checks it (nix/verify-backup.sh).
  verifyBackup = pkgs.writeShellApplication {
    name = "unhalteproblem-verify-backup";
    runtimeInputs = [ config.services.postgresql.package pkgs.coreutils ];
    text = builtins.readFile ./verify-backup.sh;
  };

  backendUrl = path: "http://127.0.0.1:${toString cfg.port}${path}";

  proxyHeaders = ''
    # Overwrite, never append: the backend rate-limits by this header.
    proxy_set_header X-Real-IP $remote_addr;
    # Lets the backend's log lines be matched to nginx's access log.
    proxy_set_header X-Request-Id $request_id;
  '';

  proxyConfig = proxyHeaders + ''
    # Same limit as the backend's MaxBodySize, so oversized requests get a
    # clean 413 here instead of a dropped connection there.
    client_max_body_size 32k;
  '';

  # The website's security headers. A location with an `add_header` of its own
  # inherits none of the server's, so it must include these again.
  #
  # The SPA loads its scripts, styles, fonts and images from its own origin
  # (documents only show our own uploads). Styles allow 'unsafe-inline' for
  # the editor's style attributes (text alignment); data: covers assets Vite
  # inlines. form-action is left out on purpose: the logout form's redirect
  # to Keycloak would count against it. The backend's own CSP on uploaded
  # images and crawler pages is enforced in addition to this one.
  securityHeaders = lib.optionalString cfg.nginx.securityHeaders ''
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  '';

  # Login start and callback each write a row to Postgres, so they get their
  # own limit. Exact locations take precedence over the "/api/" prefix, and
  # proxy_pass with a URI replaces the whole matched path while keeping the
  # query string (returnTo, code, state).
  authRateLimited = path: {
    proxyPass = backendUrl path;
    extraConfig = proxyConfig + ''
      limit_req zone=unhalteproblem_auth burst=20 nodelay;
      limit_req_status 429;
    '';
  };
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
        OIDC_ISSUER = "https://auth.unhalteproblem.de/realms/unhalteproblem-main";
        OIDC_CLIENT_ID = "unhalteproblem-backend";
        PUBLIC_ORIGIN = "https://unhalteproblem.de";
        POSTGRES_HOST = "host.containers.internal";
        POSTGRES_DB = "unhalteproblem";
        POSTGRES_USER = "unhalteproblem";
        SESSION_MAX_AGE = "8 hours";
        CONTACT_RATE_LIMIT = "5";
        CONTACT_RATE_LIMIT_WINDOW = "1 hour";
        # AUDIT_RETENTION = "365 days"; CONTACT_RETENTION = "90 days";
        # Mail about contact messages; SMTP_PASSWORD belongs in environmentFiles.
        # SMTP_HOST = "mail.example.org";
        # SMTP_FROM = "Website <noreply@unhalteproblem.de>";
        # CONTACT_MAIL_TO = "me@example.org";
        # Food planner (meal plans need ANTHROPIC_API_KEY in environmentFiles).
        # CLAUDE_MODEL = "claude-opus-5-5"; CLAUDE_EFFORT = "medium";
        # Payments (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in environmentFiles).
        # STRIPE_AUTOMATIC_TAX = "false"; TIP_CURRENCY = "eur";
      };
      description = ''
        Extra, non-secret environment variables for the backend (see
        services/backend/README.md for all of them and their defaults).
        HOST, PORT and LOG_FORMAT are set by the image.

        These values are written to the world-readable Nix store, so secrets
        (OIDC_CLIENT_SECRET, KEYCLOAK_ADMIN_CLIENT_SECRET, POSTGRES_PASSWORD, SMTP_PASSWORD,
        ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) go into
        {option}`environmentFiles` instead.

        POSTGRES_HOST defaults to localhost, which inside the container is
        the container itself. For a Postgres on the host use
        host.containers.internal or 10.88.0.1 (podman); see the comment at
        the top of nix/backend-module.nix for the Postgres and firewall side.
      '';
    };

    environmentFiles = lib.mkOption {
      # externalPath rejects Nix path literals such as ./secrets.env, which
      # would be copied to the store. Older nixpkgs lack it.
      type = lib.types.listOf (lib.types.externalPath or lib.types.path);
      default = [ ];
      example = [ "/run/secrets/unhalteproblem-backend.env" ];
      description = ''
        Environment files (`NAME=value` per line) read by the container
        runtime on the host when the container starts, so they can be
        root-only. This is where secrets belong: OIDC_CLIENT_SECRET, KEYCLOAK_ADMIN_CLIENT_SECRET
        (required) and POSTGRES_PASSWORD (if the database uses password
        authentication). Provide them outside the Nix store, e.g. with
        sops-nix (`config.sops.secrets.<name>.path`) or agenix
        (`config.age.secrets.<name>.path`).
      '';
    };

    nginx.virtualHost = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "unhalteproblem.de";
      description = ''
        nginx virtual host that gets a /api/ location proxying to the backend
        (the /api prefix is stripped), with rate limits on /api/contact,
        /api/auth/login, /api/auth/callback and /api/ready. Requests from
        crawlers and link-preview bots (by user agent) for the website's
        public pages are answered with the backend's server-rendered pages
        instead, and /sitemap.xml comes from the backend. The virtual host
        itself (TLS, root) is configured elsewhere. null leaves nginx alone.
      '';
    };

    nginx.securityHeaders = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether the virtual host sends the website's security headers (CSP,
        HSTS, framing, referrer and sniffing protection) on every response.
        nginx drops all inherited `add_header`s in a location that has one of
        its own, so a location added elsewhere with an `add_header` must
        repeat them. Turn this off to set the headers yourself.
      '';
    };

    backup = {
      enable = lib.mkEnableOption ''
        regular dumps of the backend's database, each restored into a scratch
        database right away to prove it works. Needs
        `services.postgresql` on this host. The dumps stay on this machine:
        copy them elsewhere too (a disk failure takes both the database and
        its backups), e.g. with restic or rsync from {option}`backup.location`
      '';

      database = lib.mkOption {
        type = lib.types.str;
        default = cfg.environment.POSTGRES_DB or "unhalteproblem";
        defaultText = lib.literalExpression ''environment.POSTGRES_DB or "unhalteproblem"'';
        description = "Name of the database to dump.";
      };

      location = lib.mkOption {
        type = lib.types.path;
        default = "/var/backup/unhalteproblem";
        description = ''
          Directory for the dumps (`<database>-<date>.dump`, pg_dump custom
          format), owned by the postgres user and not readable by others:
          they contain everything in the database, including personal data.
        '';
      };

      startAt = lib.mkOption {
        type = lib.types.str;
        default = "03:15";
        example = "hourly";
        description = "When to dump, as a systemd calendar expression.";
      };

      keepDays = lib.mkOption {
        type = lib.types.ints.positive;
        default = 14;
        description = "Dumps older than this many days are deleted after a successful run.";
      };
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      assertions = [
        {
          assertion = cfg.environmentFiles != [ ] || cfg.environment ? OIDC_CLIENT_SECRET;
          message = ''
            services.unhalteproblem-backend: the backend needs OIDC_CLIENT_SECRET.
            Put it in a file listed in services.unhalteproblem-backend.environmentFiles.
          '';
        }
      ];

      warnings = map
        (name: ''
          services.unhalteproblem-backend.environment.${name} is written to the
          world-readable Nix store. Move it to a file in
          services.unhalteproblem-backend.environmentFiles.
        '')
        (lib.filter (name: cfg.environment ? ${name}) secretVariables);

      virtualisation.oci-containers.containers.unhalteproblem-backend = {
        image = "${image.imageName}:${image.imageTag}";
        imageFile = image;
        ports = [ "127.0.0.1:${toString cfg.port}:3000" ];
        inherit (cfg) environment environmentFiles;
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
      # limiter: 1 MB of state per zone (about 16k addresses, oldest evicted
      # first).
      services.nginx.appendHttpConfig = ''
        limit_req_zone $binary_remote_addr zone=unhalteproblem_contact:1m rate=6r/m;
        limit_req_zone $binary_remote_addr zone=unhalteproblem_auth:1m rate=30r/m;
        limit_req_zone $binary_remote_addr zone=unhalteproblem_seo:1m rate=10r/s;
        limit_req_zone $binary_remote_addr zone=unhalteproblem_webhook:1m rate=20r/s;

        # Crawlers and link-preview bots get server-rendered pages instead of
        # the SPA's empty shell (see services/backend/docs/seo.md). Only tokens
        # of fetchers, never of apps: the in-app browsers of Twitter, LinkedIn,
        # Slack and the like put those names in their user agents too, and
        # their users must get the SPA. Bots say so (Twitterbot, Slackbot,
        # Discordbot, LinkedInBot, TelegramBot, Googlebot, bingbot, ...).
        map $http_user_agent $unhalteproblem_crawler {
          default 0;
          "~*(bot|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp/|mastodon/|skypeuripreview|slack-imgproxy)" 1;
        }

        # The crawler page behind each of the website's public URLs. Anything
        # else (editors, forms, unknown paths) stays with the SPA.
        map "$unhalteproblem_crawler$uri" $unhalteproblem_seo_uri {
          default "";
          "~^1/?$" /api/seo/pages/home;
          "~^1/(?<page>about|contact|blog|projects)/?$" /api/seo/pages/$page;
          "~^1/blog/(?<blog>[a-z0-9-]+)/?$" /api/seo/blogs/$blog;
          "~^1/blog/(?<blog>[a-z0-9-]+)/(?<post>[a-z0-9-]+)/?$" /api/seo/blogs/$blog/posts/$post;
          "~^1/projects/(?<project>[a-z0-9-]+)/?$" /api/seo/projects/$project;
        }

        # The only query parameter the crawler pages take is the page number
        # of a blog's list; everything else (tracking, filters) is dropped.
        map $arg_page $unhalteproblem_seo_args {
          default "";
          "~^[0-9]{1,3}$" "page=$arg_page";
        }
      '';

      # Runs before the location is chosen, so it needs to know nothing about
      # how the rest of the virtual host serves the SPA. rewrite appends the
      # current arguments, so they are replaced by the cleaned ones first.
      services.nginx.virtualHosts.${cfg.nginx.virtualHost} = {
        extraConfig = securityHeaders + ''
          if ($unhalteproblem_seo_uri != "") {
            set $args $unhalteproblem_seo_args;
            rewrite ^ $unhalteproblem_seo_uri last;
          }
        '';

        locations = {
          # Everything else, including /api/auth/session and
          # /api/auth/backchannel-logout (called server-to-server by Keycloak,
          # so it must not share a per-IP limit), is not limited by nginx.
          "/api/" = {
            # The trailing slash strips the /api prefix: /api/health -> /health.
            proxyPass = backendUrl "/";
            extraConfig = proxyConfig;
          };
          "= /api/contact" = {
            proxyPass = backendUrl "/contact";
            extraConfig = proxyConfig + ''
              limit_req zone=unhalteproblem_contact burst=5 nodelay;
              limit_req_status 429;
            '';
          };
          # /ready runs a query on every call: same limit as the login routes.
          # The container's own healthcheck calls the backend directly.
          "= /api/ready" = authRateLimited "/ready";
          "= /api/auth/login" = authRateLimited "/auth/login";
          "= /api/auth/callback" = authRateLimited "/auth/callback";
          # The crawler pages (the target of the rewrite above) and the sitemap.
          # They read the database, so they are rate limited as well.
          "~ ^/api/seo/" = {
            proxyPass = backendUrl "";
            extraConfig = proxyConfig + securityHeaders + ''
              limit_req zone=unhalteproblem_seo burst=30 nodelay;
              limit_req_status 429;
              # The same URL answers people with the SPA.
              add_header Vary User-Agent always;
              rewrite ^/api(/.*)$ $1 break;
            '';
          };
          "= /sitemap.xml" = {
            proxyPass = backendUrl "/sitemap.xml";
            extraConfig = proxyConfig + ''
              limit_req zone=unhalteproblem_seo burst=5 nodelay;
              limit_req_status 429;
            '';
          };
          # Stripe's webhook: events (an invoice with many lines) can exceed
          # 32k; the backend allows 512 KiB (`LargeBody`) and checks the
          # signature. The rate limit is far above what Stripe sends and only
          # bounds a flood of forged deliveries (Stripe retries a 429).
          "= /api/payments/stripe/webhook" = {
            proxyPass = backendUrl "/payments/stripe/webhook";
            extraConfig = proxyHeaders + ''
              client_max_body_size 512k;
              limit_req zone=unhalteproblem_webhook burst=100 nodelay;
              limit_req_status 429;
            '';
          };
          # Saving a post or project (512 KiB of JSON) and uploading an image
          # (5 MiB) need more than the 32k of every other route; the backend
          # enforces the exact limits per endpoint. A regex location can't
          # proxy_pass with a URI, so the /api prefix is stripped by a rewrite.
          "~ ^/api/(blogs/[^/]+/manage|admin/projects)(/|$)" = {
            proxyPass = backendUrl "";
            extraConfig = proxyHeaders + ''
              client_max_body_size 6m;
              rewrite ^/api(/.*)$ $1 break;
            '';
          };
        };
      };
    })

    (lib.mkIf cfg.backup.enable {
      assertions = [
        {
          assertion = config.services.postgresql.enable;
          message = ''
            services.unhalteproblem-backend.backup needs services.postgresql
            on this host (it dumps as the postgres user over the local socket).
          '';
        }
      ];

      systemd.tmpfiles.rules = [
        "d ${cfg.backup.location} 0700 postgres postgres -"
      ];

      # Dump, then restore the dump into a scratch database and check it.
      # Only after that succeeded are old dumps deleted, so a run that fails
      # (the unit shows up as failed in `systemctl --failed`) never costs a
      # working backup.
      # A run missed because the machine was off happens when it is back.
      systemd.timers.unhalteproblem-backup.timerConfig.Persistent = true;

      systemd.services.unhalteproblem-backup = {
        description = "Dump and verify the unhalteproblem database";
        startAt = cfg.backup.startAt;
        after = [ "postgresql.service" ];
        requires = [ "postgresql.service" ];
        path = [ config.services.postgresql.package pkgs.coreutils pkgs.findutils ];
        serviceConfig = {
          Type = "oneshot";
          User = "postgres";
          UMask = "0077";
        };
        script = ''
          dir=${lib.escapeShellArg cfg.backup.location}
          db=${lib.escapeShellArg cfg.backup.database}
          stamp=$(date +%Y-%m-%d-%H%M%S)
          partial="$dir/.$db-$stamp.partial"
          trap 'rm -f "$partial"' EXIT

          pg_dump --format=custom --file="$partial" "$db"
          mv "$partial" "$dir/$db-$stamp.dump"

          # It must restore and hold as many migrations as the live database.
          # A dump that doesn't is renamed, so that the newest `*.dump` is
          # always one that was proven, and the unit fails.
          expected=$(psql --no-psqlrc --tuples-only --no-align --dbname "$db" \
            --command "SELECT count(*) FROM effect_sql_migrations")
          if ! ${verifyBackup}/bin/unhalteproblem-verify-backup \
            "$dir/$db-$stamp.dump" postgres "$expected"; then
            mv "$dir/$db-$stamp.dump" "$dir/$db-$stamp.dump.failed"
            echo "backup $db-$stamp failed verification" >&2
            exit 1
          fi

          find "$dir" -maxdepth 1 \( -name '*.dump' -o -name '*.dump.failed' \) \
            -mtime +${toString cfg.backup.keepDays} -delete
        '';
      };
    })
  ]);
}
