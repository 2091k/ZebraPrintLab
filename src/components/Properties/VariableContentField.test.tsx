// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useLabelStore } from "../../store/labelStore";
import { VariableContentField } from "./VariableContentField";
import type { BindableLeaf } from "../../lib/variableField";
import en from "../../locales/en";

// Assert against locale keys, not literal English, so wording edits don't break.
const tf = en.variableField;

const obj = (content: string, variableId?: string): BindableLeaf =>
  ({
    id: "o1",
    type: "text",
    x: 0,
    y: 0,
    ...(variableId ? { variableId } : {}),
    props: { content },
  }) as unknown as BindableLeaf;

beforeEach(() => {
  useLabelStore.setState({
    locale: "en",
    showZplCommands: false,
    pages: [{ objects: [obj("hello") as never] }],
    currentPageIndex: 0,
    variables: [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "DEF" }],
    selectedIds: [],
    previewMode: { status: "idle" },
  });
  useLabelStore.temporal.getState().clear();
});

afterEach(() => cleanup());

describe("VariableContentField mode-dependent rendering", () => {
  it("literal field shows the bind-whole control + hint", () => {
    render(<VariableContentField obj={obj("hello")} />);
    expect(screen.getByText(tf.bindWholeField)).toBeTruthy();
    expect(screen.getByText(tf.literalHint)).toBeTruthy();
    // No single-bind default editor in literal mode.
    expect(screen.queryByText(tf.singleHint)).toBeNull();
  });

  it("single-bound field shows the variable's default value editor", () => {
    useLabelStore.setState({ pages: [{ objects: [obj("DEF", "v1") as never] }] });
    render(<VariableContentField obj={obj("DEF", "v1")} />);
    const editor = screen.getByLabelText(en.variables.defaultLabel) as HTMLTextAreaElement;
    expect(editor.value).toBe("DEF");
    expect(screen.getByText(tf.singleHint)).toBeTruthy();
  });

  it("template field lists its variables in the disclosure", () => {
    useLabelStore.setState({ pages: [{ objects: [obj("a«sku»b") as never] }] });
    render(<VariableContentField obj={obj("a«sku»b")} />);
    expect(screen.getByText(tf.optionsTitle)).toBeTruthy();
    expect(screen.getByText("sku")).toBeTruthy();
  });

  it("leaves the token editor :empty for an empty field (placeholder renders)", () => {
    const { container } = render(
      <VariableContentField obj={obj("")} placeholder="Type here" />,
    );
    const editor = container.querySelector("[contenteditable]") as HTMLElement;
    // No trailing <br>: an empty editor must match :empty so the CSS
    // placeholder (empty:before) can render.
    expect(editor.innerHTML).toBe("");
  });
});

describe("VariableContentField single-bind default editing", () => {
  it("edits the variable default in a single undo entry (atomic write)", () => {
    useLabelStore.setState({ pages: [{ objects: [obj("DEF", "v1") as never] }] });
    useLabelStore.temporal.getState().clear();
    render(<VariableContentField obj={obj("DEF", "v1")} />);

    const editor = screen.getByLabelText(en.variables.defaultLabel) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "NEW" } });

    const st = useLabelStore.getState();
    expect(st.variables[0]?.defaultValue).toBe("NEW");
    // The object content is mirrored in the same write (unbind fallback + ^FB).
    const obj0 = st.pages[0]?.objects[0] as { props: { content: string } };
    expect(obj0.props.content).toBe("NEW");
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(1);
  });

  it("re-emitting the same default value pushes no undo entry", () => {
    useLabelStore.setState({ pages: [{ objects: [obj("DEF", "v1") as never] }] });
    useLabelStore.temporal.getState().clear();
    render(<VariableContentField obj={obj("DEF", "v1")} />);

    const editor = screen.getByLabelText(en.variables.defaultLabel) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "DEF" } });

    expect(useLabelStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("applies sanitise + maxLength to the single-bind default (printed value)", () => {
    useLabelStore.setState({
      pages: [{ objects: [obj("0123", "v1") as never] }],
      variables: [{ id: "v1", name: "ean", fnNumber: 1, defaultValue: "0123" }],
    });
    render(
      <VariableContentField
        obj={obj("0123", "v1")}
        multiline={false}
        sanitise={(raw) => raw.replace(/\D/g, "")}
        maxLength={4}
      />,
    );

    const editor = screen.getByLabelText(en.variables.defaultLabel) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "ab12cd99" } });

    const st = useLabelStore.getState();
    expect(st.variables[0]?.defaultValue).toBe("1299");
    expect((st.pages[0]?.objects[0] as { props: { content: string } }).props.content).toBe("1299");
  });
});
