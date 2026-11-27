import type { ReactNode } from "react";
import { vi } from "vitest";

vi.mock("lucide-react", () => ({
  TrendingUp: () => <div data-testid="trending-up">TrendingUp</div>,
  TrendingDown: () => <div data-testid="trending-down">TrendingDown</div>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  CardHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
  CardDescription: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-description">{children}</div>
  ),
}));
