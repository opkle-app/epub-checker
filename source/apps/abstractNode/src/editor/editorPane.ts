import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxTree,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { EpubInspectError } from "../core/types.js";

type EditorChangeHandler = (content: string) => void;

class EditorPane {
  /*
   * CodeMirror is wrapped behind this small adapter so the rest of the renderer
   * can think in EPUB terms: active file, validation issues, and focus target.
   * Keep setFile/setIssues/focusLine stable when changing editor internals.
   */
  public root: HTMLElement;
  private title: HTMLElement;
  private issueBar: HTMLElement;
  private editorHost: HTMLElement;
  private onChange: EditorChangeHandler;
  private view: EditorView;
  private languageCompartment: Compartment = new Compartment();
  private decorationCompartment: Compartment = new Compartment();
  private lineSeparatorCompartment: Compartment = new Compartment();
  private currentFilePath: string = "";
  private isSettingContent: boolean = false;

  constructor(onChange: EditorChangeHandler) {
    this.onChange = onChange;
    this.root = document.createElement("section");
    this.root.className = "editor-pane";
    this.title = document.createElement("div");
    this.title.className = "editor-title";
    this.issueBar = document.createElement("div");
    this.issueBar.className = "editor-issue-bar";
    this.editorHost = document.createElement("div");
    this.editorHost.className = "editor-cm-host";

    this.root.append(this.title, this.issueBar, this.editorHost);
    this.view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: this.createExtensions("", ""),
      }),
      parent: this.editorHost,
    });
  }

  // CodeMirror's `Text` always splits/joins with plain "\n" internally unless
  // told otherwise via this facet — without it, loading a CRLF-authored XHTML
  // file (common from Windows-authored EPUBs) and saving after a single
  // keystroke silently rewrites every line ending in the file to LF. Detecting
  // CRLF in the loaded content and configuring the facet makes CodeMirror
  // split/join using the file's own original separator instead.
  private getLineSeparatorExtension = (content: string): Extension => {
    return content.includes("\r\n") ? EditorState.lineSeparator.of("\r\n") : [];
  };

  private createExtensions = (filePath: string, content: string): Extension[] => {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      lintGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      this.createAbstractTheme(),
      syntaxHighlighting(this.createAbstractHighlightStyle(), { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      this.languageCompartment.of(this.getLanguageExtension(filePath)),
      this.decorationCompartment.of(this.getDecorationExtensions(filePath)),
      this.lineSeparatorCompartment.of(this.getLineSeparatorExtension(content)),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.isSettingContent) {
          // `doc.toString()` always joins with "\n" regardless of the
          // lineSeparator facet (Text is separator-agnostic internally) —
          // toJSON() + an explicit join is the documented way to serialize
          // back out using the file's actual configured separator.
          const lineSeparator = update.state.facet(EditorState.lineSeparator) ?? "\n";
          this.onChange(update.state.doc.toJSON().join(lineSeparator));
        }
      }),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
    ];
  };

  private getLanguageExtension = (filePath: string): Extension => {
    const lower = filePath.toLowerCase();
    if (/\.(css)$/.test(lower)) {
      return css();
    }
    if (/\.(xhtml|html?)$/.test(lower)) {
      return html({
        autoCloseTags: true,
        matchClosingTags: true,
        selfClosingTags: true,
      });
    }
    if (/\.(opf|ncx|xml)$/.test(lower)) {
      return xml();
    }
    return [];
  };

  private colorChip = {
    transparent: "transparent",
    white: "#ffffff",
    gray0: "#f7f7f7",
    gray1: "#f2f2f2",
    gray3: "#dddddd",
    gray4: "#cccccc",
    deactive: "#bbbbbb",
    shadow: "#808080",
    mint: "rgba(98, 168, 233, 1)",
    mintWhite: "#E7F4F6",
    darkDarkBlack: "#252525",
    softYellow: "#ffdd99",
    rose: "#E3A08D",
  } as const;

  private px = (value: number): string => {
    return `${value}px`;
  };

  private createAbstractTheme = (): Extension => {
    // Theme values intentionally mirror the local style sample used by the app.
    // Keeping them centralized here avoids scattering CodeMirror-specific CSS
    // across the broader renderer layout.
    const colorChip = this.colorChip;
    const fontSize = 13;
    const wordSpacing = -4.3;
    const gutterMinWidth = 27;
    const gutterPaddingLeft = 9;
    const gutterFontSize = 12.5;
    const guttersMarginRight = 9;

    return EditorView.theme(
      {
        "&": {
          backgroundColor: colorChip.white,
          color: colorChip.darkDarkBlack,
          border: "0",
          outline: "none",
          fontSize: this.px(fontSize),
          fontWeight: "500",
          lineHeight: "1.8",
          letterSpacing: "0",
          wordSpacing: this.px(wordSpacing),
        },
        ".cm-activeLineGutter": {
          backgroundColor: colorChip.mint,
          color: colorChip.white,
        },
        ".cm-activeLine": {
          backgroundColor: colorChip.mintWhite,
        },
        ".cm-angle-bracket": {
          color: colorChip.mint,
          fontWeight: "400",
        },
        ".cm-doctype, .cm-xmlstarter": {
          color: colorChip.mint,
          fontWeight: "400",
        },
        ".cm-attr-quote, .cm-attr-quote .ͼr, .cm-attr-quote .cr": {
          color: colorChip.gray3,
          fontWeight: "400",
        },
        ".cm-attribute-name": {
          color: colorChip.rose,
          marginLeft: "3.2px",
          fontStyle: "italic",
        },
        ".cm-panels": {
          zIndex: "3",
        },
        ".cm-panels-bottom": {
          zIndex: "3",
          display: "none",
          borderTop: `1px solid ${colorChip.rose} !important`,
        },
        ".cm-scroller, .cm-gutter, .cm-gutterElement": {
          backgroundColor: colorChip.white,
        },
        ".cm-gutters": {
          cursor: "pointer",
          border: "none",
          marginRight: this.px(guttersMarginRight),
        },
        ".cm-gutter-lint": {
          width: "2em",
        },
        ".cm-content, .cm-line": {
          backgroundColor: colorChip.transparent,
        },
        ".cm-editor .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
          backgroundColor: colorChip.softYellow,
          border: "none",
        },
        ".cm-gutters .cm-gutterElement, .cm-lineNumbers .cm-gutterElement": {
          color: colorChip.gray4,
          fontSize: this.px(gutterFontSize - 1),
          paddingLeft: this.px(gutterPaddingLeft),
          minWidth: this.px(gutterMinWidth),
          lineHeight: "2.02",
        },
        ".cm-foldGutter .cm-gutterElement": {
          cursor: "pointer",
        },
        ".cm-lint-marker": {
          width: "12px",
          height: "12px",
          marginInlineStart: "2px",
          transform: "scale(0.72)",
          transformOrigin: "center",
        },
        ".cm-lint-marker-error, .cm-lint-marker-warning, .cm-lint-marker-info": {
          width: "12px",
          height: "12px",
        },
        ".cm-lint-marker svg": {
          width: "12px",
          height: "12px",
          overflow: "visible",
        },
        ".cm-css-brace": {
          color: colorChip.mint,
          fontWeight: "400",
          opacity: "0.5",
        },
        ".cm-css-property": {
          color: colorChip.rose,
          fontWeight: "400",
        },
        ".cm-css-selector, .cm-css-selector *": {
          color: colorChip.mint,
          fontWeight: "400",
        },
        ".cm-css-value, .cm-css-value *, .cm-css-number, .cm-css-number *, .cm-css-declaration, .cm-css-declaration *":
          {
            color: colorChip.darkDarkBlack,
            fontWeight: "400",
          },
        ".cm-css-bin, .cm-css-bin *, .cm-css-unit, .cm-css-unit *": {
          color: colorChip.mint,
          fontWeight: "400",
        },
        ".cm-css-call, .cm-css-call *": {
          color: colorChip.rose,
          fontWeight: "400",
        },
        ".cm-css-color, .cm-css-color *": {
          color: colorChip.darkDarkBlack,
          fontWeight: "400",
        },
        ".cm-css-semicolon, &.cm-focused .cm-selectionBackground": {
          color: colorChip.deactive,
          fontWeight: "400",
        },
        ".cm-cursor": {
          borderLeft: "1.5px solid black",
          marginLeft: "-0.75px",
          display: "inline-block",
          width: "0",
        },
        ".cm-cursor.cm-cursor-secondary": {
          borderLeft: "1.5px solid rgba(0, 0, 0, 0.4)",
        },
        ".cm-editor ::selection": {
          color: colorChip.white,
        },
        ".cm-tooltip-autocomplete": {
          backgroundColor: colorChip.white,
          border: `0 solid ${colorChip.transparent}`,
          borderRadius: this.px(6),
          boxShadow: `0px 4px 18px -9px ${colorChip.shadow}`,
        },
        ".cm-tooltip-autocomplete li .cm-completionLabel": {
          fontFamily: "RedditMono, monospace !important",
          color: `${colorChip.darkDarkBlack} !important`,
          paddingLeft: `${this.px(6)} !important`,
        },
        ".cm-tooltip-autocomplete li[aria-selected=true] .cm-completionLabel": {
          color: `${colorChip.white} !important`,
        },
        ".cm-tooltip-autocomplete li[aria-selected=true]": {
          background: `${colorChip.mint} !important`,
          borderRadius: `${this.px(4)} !important`,
        },
        ".cm-tooltip-autocomplete li": {
          paddingTop: `${this.px(6)} !important`,
          paddingBottom: `${this.px(7)} !important`,
        },
        ".cm-tooltip-autocomplete li div::after, .cm-tooltip-autocomplete li div": {
          content: "'' !important",
          display: "none !important",
        },
        ".cm-panel.cm-search": {
          display: "none !important",
        },
        ".cm-panel.cm-search input": {
          outline: "0 !important",
          fontSize: "80% !important",
          fontFamily: '"RedditMono", "Pretendard" !important',
          border: `0 solid ${colorChip.white} !important`,
          borderRadius: `${this.px(4)} !important`,
          background: `${colorChip.gray1} !important`,
          wordSpacing: "-3px !important",
        },
        ".cm-panel.cm-search .cm-button": {
          background: `${colorChip.rose} !important`,
          border: `0 solid ${colorChip.white} !important`,
          borderRadius: `${this.px(4)} !important`,
          fontFamily: '"Pretendard" !important',
          fontWeight: "800 !important",
          color: `${colorChip.white} !important`,
        },
      },
      { dark: false },
    );
  };

  private createAbstractHighlightStyle = (): HighlightStyle => {
    const colorChip = this.colorChip;
    return HighlightStyle.define([
      { tag: tags.keyword, color: colorChip.mint, fontWeight: "400" },
      { tag: tags.comment, color: colorChip.deactive, fontWeight: "400" },
      { tag: tags.string, color: colorChip.mint, fontWeight: "400", fontStyle: "italic" },
      { tag: tags.variableName, color: colorChip.mint, fontWeight: "400" },
      { tag: tags.number, color: colorChip.mint, fontWeight: "400" },
      { tag: tags.operator, color: colorChip.gray3, fontWeight: "400" },
      { tag: tags.tagName, color: colorChip.mint, fontWeight: "400" },
      { tag: tags.attributeName, color: colorChip.rose, fontWeight: "400", fontStyle: "italic" },
      { tag: tags.attributeValue, color: colorChip.rose, fontWeight: "400", opacity: "0.5" },
      { tag: tags.angleBracket, color: colorChip.mint, fontWeight: "400", opacity: "0.5" },
    ]);
  };

  // Reusable factory: wraps a regex + CSS class into a CodeMirror ViewPlugin
  // that decorates every match in the visible viewport. Used below to add
  // visual distinctions (doctype, angle brackets, attribute quotes, inline
  // CSS, ...) that the stock XML/HTML/CSS language packages don't tag on
  // their own, without hand-writing a ViewPlugin per case.
  private createRegexHighlighter = (regex: RegExp, className: string): Extension => {
    const mark = Decoration.mark({ class: className });
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
              const start = from + match.index;
              const end = start + match[0].length;
              try {
                builder.add(start, end, mark);
              } catch {}
              if (match[0].length === 0 && regex.lastIndex === match.index) {
                regex.lastIndex++;
              }
            }
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createAttributeQuoteHighlighter = (): Extension => {
    const mark = Decoration.mark({ class: "cm-attr-quote" });
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const tree = syntaxTree(view.state);
          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (nodeRef) => {
                if (nodeRef.name !== "AttributeValue") {
                  return;
                }
                const nodeFrom = nodeRef.from;
                const nodeTo = nodeRef.to;
                if (nodeTo <= nodeFrom) {
                  return;
                }
                const firstChar = view.state.doc.sliceString(nodeFrom, nodeFrom + 1);
                const lastChar = view.state.doc.sliceString(nodeTo - 1, nodeTo);
                try {
                  if (firstChar === '"') {
                    builder.add(nodeFrom, nodeFrom + 1, mark);
                  }
                  if (lastChar === '"' && nodeTo > nodeFrom + 1) {
                    builder.add(nodeTo - 1, nodeTo, mark);
                  }
                } catch {}
              },
            });
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createAttributeNameHighlighter = (): Extension => {
    const mark = Decoration.mark({ class: "cm-attribute-name" });
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const tree = syntaxTree(view.state);
          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (nodeRef) => {
                if (nodeRef.name === "AttributeName") {
                  try {
                    builder.add(nodeRef.from, nodeRef.to, mark);
                  } catch {}
                }
              },
            });
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createTextNodeHighlighter = (): Extension => {
    const mark = Decoration.mark({
      class: "cm-text-node",
      attributes: {
        style: "font-family: Pretendard; font-weight: 500; word-spacing: 0; letter-spacing: 0;",
      },
    });
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const tree = syntaxTree(view.state);
          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (nodeRef) => {
                if (nodeRef.name !== "Text") {
                  return;
                }
                const text = view.state.doc.sliceString(nodeRef.from, nodeRef.to).trim();
                if (text.length > 0) {
                  try {
                    builder.add(nodeRef.from, nodeRef.to, mark);
                  } catch {}
                }
              },
            });
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createInlineCssHighlighter = (): Extension => {
    const colorChip = this.colorChip;
    const mark = Decoration.mark({
      attributes: {
        style: `color: ${colorChip.mint}; font-weight: 400;`,
      },
    });
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const tree = syntaxTree(view.state);
          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (nodeRef) => {
                if (nodeRef.name !== "Attribute") {
                  return;
                }
                const attrText = view.state.doc.sliceString(nodeRef.from, nodeRef.to);
                if (!/^style\s*=/i.test(attrText)) {
                  return;
                }
                const valueMatch = attrText.match(/style\s*=\s*"([^"]*)"/i);
                if (valueMatch && valueMatch[1]) {
                  const cssContent = valueMatch[1];
                  const cssStart = nodeRef.from + attrText.indexOf(cssContent);
                  try {
                    builder.add(cssStart, cssStart + cssContent.length, mark);
                  } catch {}
                }
              },
            });
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createCssSelectorHighlighter = (): Extension => {
    const mark = Decoration.mark({ class: "cm-css-selector" });
    const selectorNodeNames = new Set([
      "TagSelector",
      "ClassSelector",
      "IdName",
      "IDSelector",
      "TypeSelector",
      "PseudoClassSelector",
      "PseudoElementSelector",
      "AttributeSelector",
      "UniversalSelector",
    ]);
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const tree = syntaxTree(view.state);
          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (nodeRef) => {
                if (selectorNodeNames.has(nodeRef.name)) {
                  try {
                    builder.add(nodeRef.from, nodeRef.to, mark);
                  } catch {}
                }
              },
            });
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private createCssUnifiedHighlighter = (): Extension => {
    const marks = {
      property: Decoration.mark({ class: "cm-css-property" }),
      value: Decoration.mark({ class: "cm-css-value" }),
      number: Decoration.mark({ class: "cm-css-number" }),
      color: Decoration.mark({ class: "cm-css-color" }),
      function: Decoration.mark({ class: "cm-css-function" }),
      semicolon: Decoration.mark({ class: "cm-css-semicolon" }),
      call: Decoration.mark({ class: "cm-css-call" }),
      bin: Decoration.mark({ class: "cm-css-bin" }),
      arg: Decoration.mark({ class: "cm-css-arg" }),
      unit: Decoration.mark({ class: "cm-css-unit" }),
    };
    return ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        public update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        private buildDecorations(view: EditorView): DecorationSet {
          const tree = syntaxTree(view.state);
          const decos: Array<{ from: number; to: number; deco: Decoration }> = [];
          tree.iterate({
            from: 0,
            to: view.state.doc.length,
            enter: (nodeRef) => {
              if (nodeRef.name === "PropertyName") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.property });
              } else if (nodeRef.name === "StringLiteral" || nodeRef.name === "ValueName") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.value });
              } else if (nodeRef.name === "Unit") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.unit });
              } else if (nodeRef.name === "ColorLiteral") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.color });
              } else if (nodeRef.name === "NumberLiteral") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.number });
              } else if (nodeRef.name === "Callee") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.call });
              } else if (nodeRef.name === "BinOp") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.bin });
              } else if (nodeRef.name === "CallExpression") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.function });
              } else if (nodeRef.name === "ArgList") {
                decos.push({ from: nodeRef.from, to: nodeRef.to, deco: marks.arg });
              }
              const nextChar = view.state.doc.sliceString(nodeRef.to, nodeRef.to + 1);
              if (nextChar === ";") {
                decos.push({ from: nodeRef.to, to: nodeRef.to + 1, deco: marks.semicolon });
              }
            },
          });
          decos.sort((a, b) => a.from - b.from || a.to - b.to);
          const builder = new RangeSetBuilder<Decoration>();
          for (const { from, to, deco } of decos) {
            try {
              builder.add(from, to, deco);
            } catch {}
          }
          return builder.finish();
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    );
  };

  private getDecorationExtensions = (filePath: string): Extension[] => {
    // The language packages provide structure, while these lightweight
    // decorators reproduce the app's preferred XML/CSS visual style.
    const lower = filePath.toLowerCase();
    if (/\.(css)$/.test(lower)) {
      return [
        this.createRegexHighlighter(/[{}]/g, "cm-css-brace"),
        this.createCssSelectorHighlighter(),
        this.createCssUnifiedHighlighter(),
      ];
    }
    if (/\.(xhtml|html?|opf|ncx|xml)$/.test(lower)) {
      return [
        this.createRegexHighlighter(/<!DOCTYPE[^>]*>/gi, "cm-doctype"),
        this.createRegexHighlighter(/<\?[^>]+(\?)?>/gi, "cm-xmlstarter"),
        this.createRegexHighlighter(/(<\/?|>|\/[ ]*>)/g, "cm-angle-bracket"),
        this.createAttributeQuoteHighlighter(),
        this.createAttributeNameHighlighter(),
        this.createTextNodeHighlighter(),
        this.createInlineCssHighlighter(),
      ];
    }
    return [];
  };

  // Programmatic content replacement (e.g. switching files). isSettingContent
  // suppresses the updateListener in createExtensions so this doesn't get
  // mistaken for a user edit and re-fire onChange/auto-save.
  private replaceDocument = (content: string): void => {
    // try/finally so a throwing dispatch (e.g. a pathological extension
    // interaction) can't leave isSettingContent stuck true forever, which
    // would permanently suppress onChange/autosave for the rest of the
    // session with no visible indication anything was wrong.
    this.isSettingContent = true;
    try {
      this.view.dispatch({
        changes: {
          from: 0,
          to: this.view.state.doc.length,
          insert: content,
        },
      });
    } finally {
      this.isSettingContent = false;
    }
  };

  private getIssuePosition = (issue: EpubInspectError): { from: number; to: number } => {
    const doc = this.view.state.doc;
    const requestedLine = issue.lineNumber && issue.lineNumber > 0 ? issue.lineNumber : 1;
    const lineNumber = Math.max(1, Math.min(requestedLine, doc.lines));
    const line = doc.line(lineNumber);
    const requestedColumn = issue.column && issue.column > 0 ? issue.column : 1;
    const columnOffset = Math.max(0, Math.min(requestedColumn - 1, line.length));
    const from = line.from + columnOffset;
    const to = Math.max(from, Math.min(line.to, from + 1));
    return { from, to };
  };

  private getDiagnosticSeverity = (issue: EpubInspectError): Diagnostic["severity"] => {
    if (issue.severity === "warning") {
      return "warning";
    }
    if (issue.severity === "info" || issue.severity === "usage") {
      return "info";
    }
    return "error";
  };

  private issueToDiagnostic = (issue: EpubInspectError): Diagnostic => {
    const position = this.getIssuePosition(issue);
    return {
      from: position.from,
      to: position.to,
      severity: this.getDiagnosticSeverity(issue),
      source: issue.source ?? "issue",
      message: issue.error,
    };
  };

  // Called whenever the active internal EPUB file changes (or its content is
  // reloaded). Language/decoration extensions only get reconfigured when the
  // file path actually changes, so re-rendering the same file for auto-save
  // doesn't tear down and rebuild syntax highlighting on every keystroke.
  public setFile = (filePath: string, content: string): void => {
    this.title.textContent = filePath || "No file selected";
    if (this.currentFilePath !== filePath) {
      this.currentFilePath = filePath;
      this.view.dispatch({
        effects: [
          this.languageCompartment.reconfigure(this.getLanguageExtension(filePath)),
          this.decorationCompartment.reconfigure(this.getDecorationExtensions(filePath)),
          this.lineSeparatorCompartment.reconfigure(this.getLineSeparatorExtension(content)),
        ],
      });
    }
    // Must compare using the same facet-aware serialization as the
    // updateListener's onChange (doc.toString() always joins with "\n"
    // regardless of the lineSeparator facet). Comparing against toString()
    // here made this condition true on every render for any multi-line CRLF
    // file (content is "\r\n"-joined, toString() is always "\n"-joined),
    // so every keystroke replaced the entire document and reset the cursor.
    const currentLineSeparator = this.view.state.facet(EditorState.lineSeparator) ?? "\n";
    if (this.view.state.doc.toJSON().join(currentLineSeparator) !== content) {
      this.replaceDocument(content);
    }
  };

  public setIssues = (issues: EpubInspectError[]): void => {
    this.issueBar.innerHTML = "";
    if (issues.length === 0) {
      this.issueBar.textContent = "이 문서에 연결된 검사 항목이 없습니다.";
      this.view.dispatch(setDiagnostics(this.view.state, []));
      return;
    }

    const diagnostics = issues.map((issue) => this.issueToDiagnostic(issue));
    this.view.dispatch(setDiagnostics(this.view.state, diagnostics));

    const fragment = document.createDocumentFragment();
    for (const issue of issues.slice(0, 8)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "issue-chip";
      chip.textContent = `${issue.source ?? "issue"} ${issue.lineNumber && issue.lineNumber > 0 ? issue.lineNumber : "-"}`;
      chip.title = issue.error;
      chip.addEventListener("click", () => {
        this.focusLine(issue.lineNumber ?? 1);
      });
      fragment.appendChild(chip);
    }
    this.issueBar.appendChild(fragment);
  };

  public focusLine = (lineNumber: number): void => {
    const doc = this.view.state.doc;
    const targetLine = Math.max(1, Math.min(lineNumber, doc.lines));
    const line = doc.line(targetLine);
    this.view.focus();
    this.view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
  };
}

export { EditorPane };
