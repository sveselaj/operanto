import { describe, it, expect } from "vitest";
import { extractTemplateVariables, renderTemplate } from "./templates-render";

describe("extractTemplateVariables", () => {
  it("extracts unique variable names in first-seen order", () => {
    expect(
      extractTemplateVariables("Hi {{name}}, your {{service}} is at {{time}}. Thanks {{name}}!"),
    ).toEqual(["name", "service", "time"]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(extractTemplateVariables("Hi {{ name }}")).toEqual(["name"]);
  });

  it("returns [] when there are no placeholders", () => {
    expect(extractTemplateVariables("Hello there")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("substitutes provided values", () => {
    const { text, missing } = renderTemplate("Hi {{name}}, booked for {{date}}.", {
      name: "Sara",
      date: "Tuesday",
    });
    expect(text).toBe("Hi Sara, booked for Tuesday.");
    expect(missing).toEqual([]);
  });

  it("reports missing values and leaves the placeholder intact", () => {
    const { text, missing } = renderTemplate("Hi {{name}}, booked for {{date}}.", {
      name: "Sara",
    });
    expect(text).toBe("Hi Sara, booked for {{date}}.");
    expect(missing).toEqual(["date"]);
  });

  it("treats empty string as missing", () => {
    const { missing } = renderTemplate("Hi {{name}}", { name: "" });
    expect(missing).toEqual(["name"]);
  });
});
