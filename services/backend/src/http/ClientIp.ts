import { Option } from "effect";
import { Headers, type HttpServerRequest } from "effect/http";

/**
 * The address a request came from.
 *
 * nginx sets `X-Real-IP` to the connecting address. The header can be
 * trusted because the container's port is published on 127.0.0.1 only, so
 * nginx is the only client that can reach the service. Without the header
 * (local development) the socket address is used.
 */
export const clientIp = (
  request: HttpServerRequest.HttpServerRequest,
): string =>
  Headers.get(request.headers, "x-real-ip").pipe(
    Option.orElse(() => request.remoteAddress),
    Option.getOrElse(() => "unknown"),
  );

/**
 * The rate-limit key for a client: its IPv4 address, or the /64 prefix of
 * its IPv6 address. A single IPv6 connection usually owns a whole /64, so
 * keying by the full address would give every rotated address a fresh quota.
 */
export const clientKey = (
  request: HttpServerRequest.HttpServerRequest,
): string => {
  const ip = clientIp(request);
  if (!ip.includes(":")) return ip;
  // IPv4-mapped IPv6 (::ffff:203.0.113.7) is really an IPv4 client.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1] !== undefined) return mapped[1];
  return `${ipv6Prefix64(ip)}::/64`;
};

/** The first four groups of an IPv6 address, normalised to lowercase. */
const ipv6Prefix64 = (address: string): string => {
  const withoutZone = address.split("%")[0] ?? address;
  const [head = "", tail] = withoutZone.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array.from(
            { length: 8 - headGroups.length - tailGroups.length },
            () => "0",
          ),
          ...tailGroups,
        ];
  return groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
};
