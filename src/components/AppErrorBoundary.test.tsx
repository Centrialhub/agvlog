import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary";

vi.mock("@/lib/observability/frontendTelemetry", () => ({
  reportFrontendError: vi.fn().mockResolvedValue(undefined),
}));

const Boom = () => {
  throw new Error("test failure");
};

describe("AppErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a safe recovery screen when a descendant crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível abrir esta tela");
    expect(screen.queryByText("test failure")).not.toBeInTheDocument();
  });
});
