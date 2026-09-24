import { describe, it, expect, beforeEach } from "vitest";
import { useModalStackStore } from "@/lib/store/modal-stack";

describe("Modal Stack Store", () => {
  beforeEach(() => {
    useModalStackStore.setState({ stack: [] });
  });

  it("pushes, pops, and closes the stack", () => {
    useModalStackStore.getState().push({ type: "source-document", id: "1" });
    useModalStackStore.getState().push({ type: "source-document", id: "2" });
    expect(useModalStackStore.getState().stack.map((item) => item.id)).toEqual(["1", "2"]);

    useModalStackStore.getState().pop();
    expect(useModalStackStore.getState().stack.map((item) => item.id)).toEqual(["1"]);

    useModalStackStore.getState().closeAll();
    expect(useModalStackStore.getState().stack).toEqual([]);
  });

  it("truncates the stack when revisiting an existing entity", () => {
    const state = useModalStackStore.getState();
    state.push({ type: "source-document", id: "1" });
    state.push({ type: "source-document", id: "2" });
    state.push({ type: "source-document", id: "3" });
    state.push({ type: "source-document", id: "1" });

    expect(useModalStackStore.getState().stack).toEqual([{ type: "source-document", id: "1" }]);
  });
});
