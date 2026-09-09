import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("渲染 children", () => {
    render(
      <Sidebar>
        <span>子内容</span>
      </Sidebar>,
    );

    expect(screen.getByText("子内容")).toBeInTheDocument();
  });

  it("合并传入的 className", () => {
    render(
      <Sidebar className="custom-class">
        <span>子内容</span>
      </Sidebar>,
    );

    expect(screen.getByText("子内容").parentElement).toHaveClass(
      "custom-class",
    );
  });
});
