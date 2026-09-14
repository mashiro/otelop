import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchFilter } from "./search-filter";

describe("SearchFilter", () => {
  it("submits only on Enter and leaves IME composition uncommitted", () => {
    const submit = vi.fn((text: string) => text);
    render(<SearchFilter value="" onSubmit={submit} placeholder="Search…" />);
    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "にほ" } });
    expect(input.value).toBe("にほ");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "日本" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith("日本");
  });
  it("clears the draft and submits an empty value", () => {
    const submit = vi.fn((text: string) => text);
    render(<SearchFilter value="checkout" onSubmit={submit} placeholder="Search…" />);
    fireEvent.click(screen.getByRole("button"));
    expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("");
    expect(submit).toHaveBeenCalledWith("");
  });
  it("reflects a changed URL value without committing an unfinished draft", () => {
    const submit = vi.fn((text: string) => text);
    const { rerender } = render(
      <SearchFilter value="checkout" onSubmit={submit} placeholder="Search…" />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "draft" } });
    rerender(<SearchFilter value="billing" onSubmit={submit} placeholder="Search…" />);
    expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("billing");
    expect(submit).not.toHaveBeenCalled();
  });
  it("removes a filter-only expression even when the normalized text remains empty", () => {
    const submit = vi.fn(() => "");
    render(<SearchFilter value="" onSubmit={submit} placeholder="Search…" />);
    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'attributes.http.method:"GET"' } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit.mock.calls).toEqual([['attributes.http.method:"GET"'], [""]]);
  });
});
