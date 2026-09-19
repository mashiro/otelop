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

  it("size=sm dims the segmented background without leaving the opaque default", () => {
    render(
      <Tabs value="a">
        <TabsList size="sm">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist");
    const cls = classes(list);
    expect(cls).toContain("bg-muted/50");
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

  it("size=sm + tone applies the small facet chrome and tone color, dropping the default active background", () => {
    render(
      <Tabs value="a">
        <TabsList size="sm">
          <TabsTrigger value="a" size="sm" tone="metric">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("h-7");
    expect(cls).toContain("px-3");
    expect(cls).toContain("text-xs");
    expect(cls).toContain("data-active:bg-metric/15");
    expect(cls).toContain("data-active:text-metric");
    expect(cls).not.toContain("data-active:bg-background");
    expect(cls).not.toContain("data-active:shadow-glow");
  });

  it("size=lg + tone + glow renders the nav pill chrome with the tone glow, dropping the default active background", () => {
    render(
      <Tabs value="a">
        <TabsList variant="pill">
          <TabsTrigger value="a" size="lg" tone="trace" glow>
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("rounded-lg");
    expect(cls).toContain("px-4");
    expect(cls).toContain("py-1.5");
    expect(cls).toContain("data-active:bg-trace/15");
    expect(cls).toContain("data-active:text-trace");
    expect(cls).toContain("data-active:shadow-glow");
    expect(cls).toContain("data-active:shadow-trace/20");
    expect(cls).not.toContain("data-active:bg-background");
  });

  it("glow defaults to false: tone alone does not add the glow shadow", () => {
    render(
      <Tabs value="a">
        <TabsList variant="pill">
          <TabsTrigger value="a" size="lg" tone="log">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = classes(screen.getByRole("tab"));
    expect(cls).toContain("data-active:bg-log/15");
    expect(cls).not.toContain("data-active:shadow-glow");
    expect(cls).not.toContain("data-active:shadow-log/20");
  });
});
