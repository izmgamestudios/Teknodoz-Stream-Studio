// src/classic/studio/saved-templates.test.ts
import { describe, expect, it } from "vitest";

import {
  addTemplate,
  duplicateTemplate,
  moveTemplate,
  removeTemplate,
  renameTemplate,
  updateTemplate,
} from "./saved-templates";
import { emptyScene, type Scene } from "./types";

const scene = (text: string): Scene => ({
  ...emptyScene(),
  items: [
    { id: "a", kind: "text", x: 1, y: 2, w: 3, text },
    { id: "b", kind: "image", x: 1, y: 2, w: 3, src: "blob:x" },
  ],
});

describe("saved templates", () => {
  it("adds without logos and with fresh item ids", () => {
    const { list, id } = addTemplate([], "  Açılış  ", scene("Merhaba"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "Açılış" });
    expect(list[0]?.scene.items).toHaveLength(1);
    expect(list[0]?.scene.items[0]?.id).not.toBe("a");
  });

  it("renames (ignoring blanks), updates, duplicates, moves and removes", () => {
    const first = addTemplate([], "A", scene("bir"));
    const id = first.id;
    const list = addTemplate(first.list, "B", scene("iki")).list;
    expect(renameTemplate(list, id, "   ")).toEqual(list);
    expect(renameTemplate(list, id, "Yeni")[0]?.name).toBe("Yeni");
    expect(updateTemplate(list, id, scene("üç"))[0]?.scene.items[0]?.text).toBe(
      "üç",
    );
    const dup = duplicateTemplate(list, id);
    expect(dup.list.map((t) => t.name)).toEqual(["A", "A (kopya)", "B"]);
    expect(moveTemplate(list, id, 1).map((t) => t.name)).toEqual(["B", "A"]);
    expect(moveTemplate(list, id, -1)).toEqual(list);
    expect(removeTemplate(list, id)).toHaveLength(1);
    expect(duplicateTemplate(list, "zzz").id).toBeNull();
  });
});
