import { describe, it, expect } from "vite-plus/test";
import { valueToFilterDraft } from "./log-filter";

describe("valueToFilterDraft", () => {
  it("maps null/undefined to not_exists with an empty value", () => {
    expect(valueToFilterDraft("service_name", null)).toEqual({
      key: "service_name",
      operator: "not_exists",
      value: "",
    });
    expect(valueToFilterDraft("service_name", undefined)).toEqual({
      key: "service_name",
      operator: "not_exists",
      value: "",
    });
  });

  it("maps an object (including an array) to exists with an empty value", () => {
    expect(valueToFilterDraft("attributes.arguments", { cmd: "diff" })).toEqual({
      key: "attributes.arguments",
      operator: "exists",
      value: "",
    });
    expect(valueToFilterDraft("attributes.tags", ["a", "b"])).toEqual({
      key: "attributes.tags",
      operator: "exists",
      value: "",
    });
  });

  it("maps a string/number/boolean to is with the stringified value", () => {
    expect(valueToFilterDraft("service_name", "api")).toEqual({
      key: "service_name",
      operator: "is",
      value: "api",
    });
    expect(valueToFilterDraft("severity_number", 17)).toEqual({
      key: "severity_number",
      operator: "is",
      value: "17",
    });
    expect(valueToFilterDraft("is_root", true)).toEqual({
      key: "is_root",
      operator: "is",
      value: "true",
    });
  });
});
