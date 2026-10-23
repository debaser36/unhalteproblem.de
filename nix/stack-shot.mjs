// Screenshot of one page of the local stack, used by `stack shot`.
// Configured through STACK_URL, STACK_OUT, STACK_FULL and STACK_COOKIE;
// PLAYWRIGHT_CORE and CHROMIUM_EXECUTABLE come from the dev shell.
const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);

const url = new URL(process.env.STACK_URL);
if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
  throw new Error(`refusing to open ${url}: not a local address`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  // The shell may run as root in a container, where Chromium's sandbox
  // cannot start. The page is our own dev server on loopback.
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { Cookie: process.env.STACK_COOKIE },
  });
  const page = await context.newPage();
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.screenshot({
    path: process.env.STACK_OUT,
    fullPage: process.env.STACK_FULL === "1",
  });
} finally {
  await browser.close();
}
