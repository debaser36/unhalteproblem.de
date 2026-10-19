import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "#lib/theme.ts";
import { Button } from "#ui/Button.tsx";

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      icon={theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    />
  );
}
