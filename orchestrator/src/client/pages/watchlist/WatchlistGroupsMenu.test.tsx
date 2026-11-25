import type { WatchlistSourceGroup } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatchlistGroupsMenu } from "./WatchlistGroupsMenu";

const group: WatchlistSourceGroup = {
  id: "big-tech",
  label: "Big tech",
  description: "The largest tech companies.",
  sourceIds: ["a", "b", "c"],
};

describe("WatchlistGroupsMenu", () => {
  it("adds only the sources that are still missing", async () => {
    const onAddGroup = vi.fn();
    render(
      <WatchlistGroupsMenu
        groups={[group]}
        addedCatalogSourceIds={new Set(["a"])}
        isFull={false}
        onAddGroup={onAddGroup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add a group of sources/i }));

    expect(await screen.findByText("1 of 3 added")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Big tech" }));
    expect(onAddGroup).toHaveBeenCalledWith(group);
    expect(screen.getByRole("button", { name: "Add Big tech" })).toHaveTextContent("Add 2");
  });

  it("disables a fully added group and renders nothing without groups", async () => {
    const { container, rerender } = render(
      <WatchlistGroupsMenu
        groups={[group]}
        addedCatalogSourceIds={new Set(["a", "b", "c"])}
        isFull={false}
        onAddGroup={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add a group of sources/i }));
    expect(await screen.findByRole("button", { name: "Add Big tech" })).toBeDisabled();

    rerender(
      <WatchlistGroupsMenu
        groups={[]}
        addedCatalogSourceIds={new Set()}
        isFull={false}
        onAddGroup={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
