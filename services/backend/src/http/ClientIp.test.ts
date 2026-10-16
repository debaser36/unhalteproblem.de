import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { clientIp, clientKey } from "./ClientIp.ts";

const request = (headers: Record<string, string>, remoteAddress?: string) =>
  HttpServerRequest.fromWeb(
    new Request("http://localhost/contact", { headers }),
  ).modify({
    remoteAddress: Option.fromNullishOr(remoteAddress),
  });

describe("clientIp", () => {
  it("prefers the X-Real-IP header set by nginx", () => {
    assert.strictEqual(
      clientIp(request({ "x-real-ip": "203.0.113.7" }, "127.0.0.1")),
      "203.0.113.7",
    );
  });

  it("falls back to the socket address", () => {
    assert.strictEqual(clientIp(request({}, "198.51.100.2")), "198.51.100.2");
  });

  it("uses a shared key when neither is known", () => {
    assert.strictEqual(clientIp(request({})), "unknown");
  });
});

describe("clientKey", () => {
  const key = (ip: string) => clientKey(request({ "x-real-ip": ip }));

  it("keeps IPv4 addresses as they are", () => {
    assert.strictEqual(key("203.0.113.7"), "203.0.113.7");
  });

  it("treats IPv4-mapped IPv6 as IPv4", () => {
    assert.strictEqual(key("::ffff:203.0.113.7"), "203.0.113.7");
  });

  it("groups IPv6 addresses by their /64 prefix", () => {
    assert.strictEqual(key("2001:db8:aa:bb:1:2:3:4"), "2001:db8:aa:bb::/64");
    assert.strictEqual(key("2001:DB8:AA:BB::5"), "2001:db8:aa:bb::/64");
    assert.strictEqual(key("2001:0db8::1"), "2001:db8:0:0::/64");
    assert.strictEqual(key("fe80::1%eth0"), "fe80:0:0:0::/64");
  });
});
