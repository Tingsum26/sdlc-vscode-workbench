import { describe, expect, it } from "vitest";
import { parseRosterCsv } from "../src/views/rosterCsv.js";

describe("parseRosterCsv", () => {
  it("parses header-led rows into member import inputs", () => {
    const csv = [
      "employeeId,displayLabel,role,principalId",
      "EMP-201,Fictional Developer,DEVELOPER,PRINCIPAL-EMP-201",
      "EMP-202,Fictional QA,QA,",
    ].join("\n");
    expect(parseRosterCsv(csv)).toEqual([
      { employeeId: "EMP-201", displayLabel: "Fictional Developer", role: "DEVELOPER", principalId: "PRINCIPAL-EMP-201" },
      { employeeId: "EMP-202", displayLabel: "Fictional QA", role: "QA" },
    ]);
  });

  it("skips rows missing required columns and trims surrounding whitespace", () => {
    const csv = [
      " employeeId , displayLabel , role ",
      " EMP-1 , Ada , DEVELOPER ",
      " , , , ",
      "EMP-2,,",
    ].join("\n");
    expect(parseRosterCsv(csv)).toEqual([{ employeeId: "EMP-1", displayLabel: "Ada", role: "DEVELOPER" }]);
  });

  it("returns an empty list for a headerless or single-line file", () => {
    expect(parseRosterCsv("")).toEqual([]);
    expect(parseRosterCsv("employeeId,displayLabel,role")).toEqual([]);
    expect(parseRosterCsv("name,title\nAlice,Engineer")).toEqual([]);
  });
});
