import { describe, it, expect } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

function classes(el: Element) {
  return new Set(el.className.split(/\s+/).filter(Boolean));
}

describe("TabsList", () => {
  it("defaults to the opaque segmented background", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist");
    expect(list.dataset.variant).toBe("default");
    expect(classes(list)).toContain("bg-muted");
    expect(classes(list)).not.toContain("bg-muted/50");
  });

  it("variant=pill renders a transparent, ungapped-from-default list", () => {
    render(
      <Tabs value="a">
        <TabsList variant="pill">
          <TabsTrigger value="a" size="lg" tone="trace">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist");
    expect(list.dataset.variant).toBe("pill");
    const cls = classes(list);
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("data-[variant=pill]:rounded-none");
    expect(cls).toContain("data-[variant=pill]:p-0");
    expect(cls).not.toContain("bg-muted");
  });
});

describe("TabsTrigger", () => {
  it("marks the selected trigger data-active and leaves others inactive", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const [a, b] = screen.getAllByRole("tab");
    expect(a?.hasAttribute("data-active")).toBe(true);
    expect(b?.hasAttribute("data-active")).toBe(false);
  });

  it("default size keeps the segmented control's active chrome", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("data-active:bg-background");
    expect(cls).toContain("data-active:text-foreground");
  });

  it("tone applies the signal color, dropping the default active background", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a" tone="metric">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("text-sm");
    expect(cls).toContain("data-active:bg-metric/15");
    expect(cls).toContain("data-active:text-metric");
    expect(cls).not.toContain("data-active:bg-background");
    expect(cls).not.toContain("data-active:shadow-glow");
  });

  it("size=lg + tone renders the nav pill chrome, dropping the default active background", () => {
    render(
      <Tabs value="a">
        <TabsList variant="pill">
          <TabsTrigger value="a" size="lg" tone="trace">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("px-3");
    expect(cls).toContain("py-1");
    expect(cls).toContain("data-active:bg-trace/15");
    expect(cls).toContain("data-active:text-trace");
    expect(cls).not.toContain("data-active:bg-background");
  });
});

describe("Tabs orientation", () => {
  it("passes a vertical orientation through to the tablist and its tabs", () => {
    render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("data-orientation")).toBe(
      "vertical",
    );
  });
});
