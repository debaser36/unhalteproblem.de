import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { cn } from "#lib/cn.ts";
import { Button } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { Logo } from "./Logo.tsx";
import { sections } from "./navigation.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { UserMenu } from "./UserMenu.tsx";

const linkClass = ({ isActive }: { readonly isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-1.5 font-mono text-sm transition-colors",
    isActive
      ? "bg-accent-soft text-accent"
      : "text-fg-soft hover:bg-surface-2 hover:text-fg",
  );

export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Navigating closes the mobile menu.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/75 backdrop-blur-md">
      <Container width="wide" className="flex h-16 items-center gap-4">
        <Link to="/" className="shrink-0" aria-label="unhalteproblem.de, home">
          <Logo />
        </Link>
        <nav
          aria-label="Main"
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          {sections.map((section) => (
            <NavLink key={section.to} to={section.to} className={linkClass}>
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <UserMenu />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            icon={open ? <X size={18} /> : <Menu size={18} />}
          />
        </div>
      </Container>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="animate-fade-up border-t border-border bg-bg/95 md:hidden"
        >
          <Container width="wide" className="flex flex-col gap-1 py-3">
            {sections.map((section) => (
              <NavLink key={section.to} to={section.to} className={linkClass}>
                <span className="text-accent">./</span>
                {section.label}
              </NavLink>
            ))}
          </Container>
        </nav>
      )}
    </header>
  );
}
