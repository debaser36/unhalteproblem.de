import { site, siteJsonLd } from "@unhalteproblem.de/seo";
import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";

// `index.html` is static and cannot import the site facts, so it carries
// copies for crawlers without JavaScript. This keeps them from drifting.

describe("index.html", () => {
  it("carries the site-wide structured data of the seo package", () => {
    const json =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        html,
      )?.[1];
    expect(JSON.parse(json ?? "null")).toEqual(siteJsonLd);
  });

  it("carries the site's title and description", () => {
    expect(html).toContain(`<title>${site.name} — ${site.tagline}</title>`);
    expect(html).toContain(`content="${site.description}"`);
    expect(html).toContain(`content="${site.origin}${site.image}"`);
  });
});
