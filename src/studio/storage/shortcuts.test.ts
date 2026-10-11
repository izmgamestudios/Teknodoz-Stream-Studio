import { describe, expect, it } from "vitest";
import { defaultShortcuts } from "../defaults";
import type { ShortcutMap } from "../types";
import {
  eventToCombo,
  findComboDuplicates,
  findConflicts,
  isEditableTarget,
  isValidCombo,
  matchCombo,
  normalizeCombo,
  resolveShortcut,
  SHORTCUT_ACTIONS,
  type KeyEventLike,
} from "./shortcuts";

function ev(partial: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...partial,
  };
}

describe("normalizeCombo", () => {
  it.each([
    ["Shift+R", "Shift+R"],
    ["shift+r", "Shift+R"],
    ["  shift + r  ", "Shift+R"],
    ["SHIFT+R", "Shift+R"],
    ["ctrl+alt+k", "Ctrl+Alt+K"],
    ["Alt+Ctrl+K", "Ctrl+Alt+K"],
    ["Meta+Shift+Alt+Ctrl+z", "Ctrl+Alt+Shift+Meta+Z"],
    ["Ctrl+Ctrl+K", "Ctrl+K"],
    ["Control+K", "Ctrl+K"],
    ["Cmd+K", "Meta+K"],
    ["Command+K", "Meta+K"],
    ["Option+S", "Alt+S"],
    ["m", "m"],
    ["M", "m"],
    ["Shift+m", "Shift+M"],
    ["1", "1"],
    ["Shift+1", "Shift+1"],
    ["[", "["],
    ["]", "]"],
    ["Ctrl+[", "Ctrl+["],
    ["space", "Space"],
    [" ", "Space"],
    ["Spacebar", "Space"],
    ["Shift+space", "Shift+Space"],
    ["esc", "Escape"],
    ["return", "Enter"],
    ["arrowup", "ArrowUp"],
    ["UP", "ArrowUp"],
    ["Down", "ArrowDown"],
    ["pgup", "PageUp"],
    ["del", "Delete"],
    ["f5", "F5"],
    ["Shift+f12", "Shift+F12"],
    ["F24", "F24"],
    ["+", "+"],
    ["plus", "+"],
    ["Ctrl++", "Ctrl++"],
    ["Ctrl+plus", "Ctrl++"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCombo(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "Ctrl+",
    "+Ctrl",
    "Shift",
    "Ctrl+Shift",
    "Control",
    "A+B",
    "Foo+K",
    "F25",
    "F0",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "Ctrl+constructor",
    "ab",
    "\u0000",
    "\n",
    "Ctrl+\t",
    "a".repeat(49),
  ])("rejects %j", (input) => {
    expect(normalizeCombo(input)).toBe("");
    expect(isValidCombo(input)).toBe(false);
  });

  it("rejects non-string input without throwing", () => {
    for (const bad of [undefined, null, 5, {}, [], true]) {
      expect(normalizeCombo(bad as unknown as string)).toBe("");
    }
  });

  it("is idempotent", () => {
    const inputs = [
      "shift + r",
      "ctrl+alt+k",
      "space",
      " ",
      "esc",
      "Ctrl++",
      "plus",
      "1",
      "M",
      "Shift+ı",
      "İ",
      "Cmd+Option+Shift+Ctrl+Q",
    ];
    for (const input of inputs) {
      const once = normalizeCombo(input);
      expect(normalizeCombo(once)).toBe(once);
    }
  });

  it("accepts every default shortcut unchanged", () => {
    for (const combo of Object.values(defaultShortcuts())) {
      expect(normalizeCombo(combo)).toBe(combo);
    }
  });

  it("keeps Turkish dotted and dotless i distinct", () => {
    expect(normalizeCombo("Shift+ı")).toBe("Shift+ı");
    expect(normalizeCombo("Shift+ı")).not.toBe(normalizeCombo("Shift+i"));
    expect(normalizeCombo("İ")).toBe("İ");
    expect(normalizeCombo("ı")).toBe("ı");
  });

  it("accepts a single astral character as the key", () => {
    expect(normalizeCombo("😀")).toBe("😀");
    expect(normalizeCombo("Ctrl+😀")).toBe("Ctrl+😀");
    expect(normalizeCombo("😀😀")).toBe("");
  });
});

describe("eventToCombo", () => {
  it("reports letters with the shift state", () => {
    expect(eventToCombo(ev({ key: "r" }))).toBe("r");
    expect(eventToCombo(ev({ key: "R", shiftKey: true }))).toBe("Shift+R");
    // Caps Lock without Shift reports an uppercase key; the combo stays "r".
    expect(eventToCombo(ev({ key: "R" }))).toBe("r");
  });

  it("orders modifiers Ctrl, Alt, Shift, Meta", () => {
    expect(eventToCombo(ev({ key: "k", ctrlKey: true, altKey: true }))).toBe(
      "Ctrl+Alt+K",
    );
    expect(
      eventToCombo(
        ev({
          key: "K",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBe("Ctrl+Alt+Shift+Meta+K");
    expect(eventToCombo(ev({ key: "k", metaKey: true }))).toBe("Meta+K");
  });

  it("names special keys", () => {
    expect(eventToCombo(ev({ key: " " }))).toBe("Space");
    expect(eventToCombo(ev({ key: "Spacebar" }))).toBe("Space");
    expect(eventToCombo(ev({ key: "ArrowUp" }))).toBe("ArrowUp");
    expect(eventToCombo(ev({ key: "ArrowDown", shiftKey: true }))).toBe(
      "Shift+ArrowDown",
    );
    expect(eventToCombo(ev({ key: "Enter" }))).toBe("Enter");
    expect(eventToCombo(ev({ key: "Escape" }))).toBe("Escape");
    expect(eventToCombo(ev({ key: "Esc" }))).toBe("Escape");
    expect(eventToCombo(ev({ key: "F5" }))).toBe("F5");
    expect(eventToCombo(ev({ key: "PageDown" }))).toBe("PageDown");
  });

  it("handles digits and brackets", () => {
    for (let n = 1; n <= 9; n++) {
      expect(eventToCombo(ev({ key: String(n), code: `Digit${n}` }))).toBe(
        String(n),
      );
    }
    expect(eventToCombo(ev({ key: "[" }))).toBe("[");
    expect(eventToCombo(ev({ key: "]" }))).toBe("]");
  });

  it("uses the physical digit for shifted digits (Shift+1 reports '!')", () => {
    expect(eventToCombo(ev({ key: "!", code: "Digit1", shiftKey: true }))).toBe(
      "Shift+1",
    );
    expect(
      eventToCombo(
        ev({ key: "!", code: "Digit1", shiftKey: true, ctrlKey: true }),
      ),
    ).toBe("Ctrl+Shift+1");
  });

  it("falls back to the physical key for layout-mangled Alt combos (macOS Option)", () => {
    expect(eventToCombo(ev({ key: "ß", code: "KeyS", altKey: true }))).toBe(
      "Alt+S",
    );
  });

  it("does not count AltGr (Ctrl+Alt on Windows) as modifiers", () => {
    const altGr = ev({
      key: "]",
      ctrlKey: true,
      altKey: true,
      getModifierState: (name: string) => name === "AltGraph",
    });
    expect(eventToCombo(altGr)).toBe("]");
  });

  it("returns an empty string for modifier-only, dead and unsupported keys", () => {
    for (const key of [
      "Shift",
      "Control",
      "Alt",
      "Meta",
      "AltGraph",
      "CapsLock",
      "Dead",
      "",
    ]) {
      expect(eventToCombo(ev({ key, shiftKey: key === "Shift" }))).toBe("");
    }
    expect(eventToCombo(ev({ key: "Unidentified" }))).toBe("");
    expect(eventToCombo(ev({ key: "ContextMenu" }))).toBe("");
    expect(eventToCombo(ev({ key: "MediaPlayPause" }))).toBe("");
  });

  it("never throws on malformed events", () => {
    expect(eventToCombo(ev({ key: undefined as unknown as string }))).toBe("");
    expect(
      eventToCombo(
        ev({
          key: "a",
          getModifierState: () => {
            throw new Error("boom");
          },
        }),
      ),
    ).toBe("a");
  });

  it("works with real KeyboardEvent instances", () => {
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: "R", shiftKey: true })),
    ).toBe("Shift+R");
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: " ", code: "Space" })),
    ).toBe("Space");
  });

  it("always produces canonical output (normalize is a no-op on it)", () => {
    const events: KeyEventLike[] = [
      ev({ key: "R", shiftKey: true }),
      ev({ key: "k", ctrlKey: true, altKey: true }),
      ev({ key: " " }),
      ev({ key: "!", code: "Digit1", shiftKey: true }),
      ev({ key: "ArrowLeft", metaKey: true }),
      ev({ key: "ı", shiftKey: true }),
      ev({ key: "F12", ctrlKey: true }),
    ];
    for (const e of events) {
      const combo = eventToCombo(e);
      expect(combo).not.toBe("");
      expect(normalizeCombo(combo)).toBe(combo);
    }
  });
});

describe("matchCombo", () => {
  it("matches exactly the configured combo", () => {
    const shiftR = ev({ key: "R", shiftKey: true });
    expect(matchCombo(shiftR, "Shift+R")).toBe(true);
    expect(matchCombo(shiftR, "shift+r")).toBe(true);
    expect(matchCombo(shiftR, "R")).toBe(false);
    expect(matchCombo(shiftR, "r")).toBe(false);
    expect(matchCombo(shiftR, "Ctrl+Shift+R")).toBe(false);
    expect(matchCombo(ev({ key: "r" }), "Shift+R")).toBe(false);
  });

  it("does not match with extra modifiers held", () => {
    expect(matchCombo(ev({ key: "m", ctrlKey: true }), "m")).toBe(false);
    expect(matchCombo(ev({ key: "m", metaKey: true }), "m")).toBe(false);
  });

  it("never matches an empty or invalid combo", () => {
    expect(matchCombo(ev({ key: "a" }), "")).toBe(false);
    expect(matchCombo(ev({ key: "" }), "")).toBe(false);
    expect(matchCombo(ev({ key: "a" }), "Ctrl+")).toBe(false);
    expect(matchCombo(ev({ key: "Shift", shiftKey: true }), "Shift")).toBe(
      false,
    );
  });

  it("matches alias spellings", () => {
    expect(matchCombo(ev({ key: " " }), "space")).toBe(true);
    expect(matchCombo(ev({ key: "Escape" }), "esc")).toBe(true);
    expect(matchCombo(ev({ key: "ArrowUp" }), "up")).toBe(true);
  });
});

describe("isEditableTarget", () => {
  function el(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }

  it("is true for input, textarea and select", () => {
    const host = el(
      "<input id=i><textarea id=t></textarea><select id=s></select>",
    );
    for (const id of ["i", "t", "s"]) {
      expect(isEditableTarget(host.querySelector(`#${id}`))).toBe(true);
    }
    host.remove();
  });

  it("is true for contenteditable elements and their descendants", () => {
    const host = el(
      '<div id=a contenteditable="true"><span id=b>x</span></div><div id=c contenteditable>y</div>',
    );
    expect(isEditableTarget(host.querySelector("#a"))).toBe(true);
    expect(isEditableTarget(host.querySelector("#b"))).toBe(true);
    expect(isEditableTarget(host.querySelector("#c"))).toBe(true);
    host.remove();
  });

  it("is true for ARIA textbox widgets", () => {
    const host = el('<div id=a role="textbox"></div>');
    expect(isEditableTarget(host.querySelector("#a"))).toBe(true);
    host.remove();
  });

  it("looks through text nodes to their element", () => {
    const host = el('<div contenteditable="true">hello</div>');
    const text = host.querySelector("div")?.firstChild ?? null;
    expect(text?.nodeType).toBe(3);
    expect(isEditableTarget(text)).toBe(true);
    host.remove();
  });

  it("is false for ordinary elements", () => {
    const host = el(
      '<button id=b>x</button><div id=d contenteditable="false">y</div><p id=p>z</p>',
    );
    expect(isEditableTarget(host.querySelector("#b"))).toBe(false);
    expect(isEditableTarget(host.querySelector("#p"))).toBe(false);
    expect(isEditableTarget(host.querySelector("#d"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    host.remove();
  });

  it("is false for null, undefined, window and document", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  const map = defaultShortcuts();

  it("resolves every default binding", () => {
    expect(resolveShortcut(ev({ key: "R", shiftKey: true }), map)).toBe(
      "record.toggle",
    );
    expect(resolveShortcut(ev({ key: "m" }), map)).toBe("marker.add");
    expect(resolveShortcut(ev({ key: " ", code: "Space" }), map)).toBe(
      "prompter.toggle",
    );
    expect(resolveShortcut(ev({ key: "ArrowUp" }), map)).toBe(
      "prompter.speedUp",
    );
    expect(resolveShortcut(ev({ key: "ArrowDown" }), map)).toBe(
      "prompter.speedDown",
    );
    expect(resolveShortcut(ev({ key: "r" }), map)).toBe("prompter.rewind");
    expect(resolveShortcut(ev({ key: "M", shiftKey: true }), map)).toBe(
      "audio.muteMic",
    );
    expect(resolveShortcut(ev({ key: "]" }), map)).toBe("scene.next");
    expect(resolveShortcut(ev({ key: "[" }), map)).toBe("scene.prev");
  });

  it("returns null for unbound keys and modifier-only presses", () => {
    expect(resolveShortcut(ev({ key: "q" }), map)).toBeNull();
    expect(
      resolveShortcut(ev({ key: "Shift", shiftKey: true }), map),
    ).toBeNull();
    expect(resolveShortcut(ev({ key: "m", ctrlKey: true }), map)).toBeNull();
  });

  it("ignores key repeat unless asked", () => {
    const repeated = ev({ key: "ArrowUp", repeat: true });
    expect(resolveShortcut(repeated, map)).toBeNull();
    expect(resolveShortcut(repeated, map, { allowRepeat: true })).toBe(
      "prompter.speedUp",
    );
  });

  it("does not fire while typing in editable targets", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const target = document.createElement(tag);
      const e = ev({ key: "m", target });
      expect(resolveShortcut(e, map)).toBeNull();
      expect(resolveShortcut(e, map, { allowInEditable: true })).toBe(
        "marker.add",
      );
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(resolveShortcut(ev({ key: " ", target: editable }), map)).toBeNull();
  });

  it("fires for non-editable targets", () => {
    expect(
      resolveShortcut(
        ev({ key: "m", target: document.createElement("button") }),
        map,
      ),
    ).toBe("marker.add");
    expect(resolveShortcut(ev({ key: "m", target: document.body }), map)).toBe(
      "marker.add",
    );
  });

  it("does not fire during IME composition", () => {
    expect(
      resolveShortcut(ev({ key: "m", isComposing: true }), map),
    ).toBeNull();
    expect(
      resolveShortcut(ev({ key: "Process", keyCode: 229 }), map),
    ).toBeNull();
    expect(resolveShortcut(ev({ key: "m", keyCode: 229 }), map)).toBeNull();
  });

  it("honours custom, differently spelled and unassigned bindings", () => {
    const custom: ShortcutMap = {
      ...map,
      "marker.add": "ctrl + shift + k",
      "prompter.rewind": "",
    };
    expect(
      resolveShortcut(ev({ key: "K", ctrlKey: true, shiftKey: true }), custom),
    ).toBe("marker.add");
    expect(resolveShortcut(ev({ key: "m" }), custom)).toBeNull();
    expect(resolveShortcut(ev({ key: "r" }), custom)).toBeNull();
  });

  it("resolves conflicts in favour of the earlier action", () => {
    const clash: ShortcutMap = { ...map, "scene.prev": "m" };
    expect(SHORTCUT_ACTIONS.indexOf("marker.add")).toBeLessThan(
      SHORTCUT_ACTIONS.indexOf("scene.prev"),
    );
    expect(resolveShortcut(ev({ key: "m" }), clash)).toBe("marker.add");
  });

  it("tolerates a malformed map", () => {
    expect(resolveShortcut(ev({ key: "m" }), {} as ShortcutMap)).toBeNull();
    const withJunk = { ...map, "marker.add": 5 } as unknown as ShortcutMap;
    expect(resolveShortcut(ev({ key: "m" }), withJunk)).toBeNull();
  });
});

describe("findConflicts", () => {
  it("finds nothing in the defaults", () => {
    expect(findConflicts(defaultShortcuts())).toEqual([]);
  });

  it("reports duplicate bindings", () => {
    const map: ShortcutMap = { ...defaultShortcuts(), "marker.add": "Shift+R" };
    expect(findConflicts(map)).toEqual([
      { combo: "Shift+R", ids: ["record.toggle", "marker.add"] },
    ]);
  });

  it("compares normalized combos, not raw strings", () => {
    const map: ShortcutMap = {
      ...defaultShortcuts(),
      "marker.add": "shift + r",
    };
    expect(findConflicts(map)).toEqual([
      { combo: "Shift+R", ids: ["record.toggle", "marker.add"] },
    ]);
  });

  it("groups three-way and independent conflicts", () => {
    const map: ShortcutMap = {
      ...defaultShortcuts(),
      "marker.add": "x",
      "prompter.rewind": "X",
      "scene.next": "x",
      "scene.prev": "Space",
    };
    const conflicts = findConflicts(map);
    expect(conflicts).toHaveLength(2);
    expect(conflicts).toContainEqual({
      combo: "x",
      ids: ["marker.add", "prompter.rewind", "scene.next"],
    });
    expect(conflicts).toContainEqual({
      combo: "Space",
      ids: ["prompter.toggle", "scene.prev"],
    });
  });

  it("ignores unassigned and invalid bindings", () => {
    const map: ShortcutMap = {
      ...defaultShortcuts(),
      "marker.add": "",
      "prompter.rewind": "",
      "scene.next": "Ctrl+",
      "scene.prev": "Ctrl+",
    };
    expect(findConflicts(map)).toEqual([]);
  });

  it("tolerates a malformed map", () => {
    expect(findConflicts({} as ShortcutMap)).toEqual([]);
    expect(
      findConflicts({ "marker.add": 1 } as unknown as ShortcutMap),
    ).toEqual([]);
  });
});

describe("findComboDuplicates", () => {
  it("works for arbitrary ids (scene hotkeys)", () => {
    expect(
      findComboDuplicates([
        ["scene-a", "1"],
        ["scene-b", "2"],
        ["scene-c", "1"],
        ["scene-d", ""],
        ["scene-e", ""],
      ]),
    ).toEqual([{ combo: "1", ids: ["scene-a", "scene-c"] }]);
  });
});
