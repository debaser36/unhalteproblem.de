/** The wordmark: a prompt and the domain, the cursor blinking. */
export function Logo() {
  return (
    <span className="flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/40 bg-accent-soft text-accent">
        &gt;_
      </span>
      <span className="text-fg">
        unhalteproblem
        <span className="text-muted">.de</span>
        <span className="animate-blink text-accent">▍</span>
      </span>
    </span>
  );
}
