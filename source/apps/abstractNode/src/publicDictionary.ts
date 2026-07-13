// Shared types/data for the AbstractNode DOM builder (see index.ts):
//   - DomCommand: the object shape createDom({...}) accepts.
//   - mimeTypes: extension -> MIME type lookup used when reading/serving
//     EPUB internal files and exported assets.
//   - SvgTong*/SvgDom*: a small parser/wrapper so inline SVG icon strings
//     (see appController.ts icon defs) can be inspected and styled
//     (e.g. reading viewBox to compute aspect ratio) without a full DOM
//     library dependency.

type StyleValue = string | number | null | undefined | [string | number, string | number];

type DomStyle = Partial<CSSStyleDeclaration> & Record<string, StyleValue>;

type DomEventHandler = (event: any) => any;
type DomEventMap = Record<string, DomEventHandler>;

type DomCommand = {
  mother?: HTMLElement | Element | SVGElement;
  style?: DomStyle;
  mode?: string;
  source?: string;
  text?: string | string[];
  class?: string[];
  id?: string;
  attribute?: Record<string, string>;
  event?: DomEventMap;
  child?: DomCommand;
  children?: DomCommand[];
  bold?: DomStyle;
  strike?: DomStyle;
  under?: DomStyle;
  special?: DomStyle;
  code?: DomStyle;
  italic?: DomStyle;
  reference?: DomStyle;
  anchor?: DomStyle;
  next?: DomCommand;
  previous?: DomCommand;
  pass?: boolean;
  unshift?: boolean;
  position?: number;
};

const mimeTypes: Record<string, string> = {
  aac: "audio/aac",
  abw: "application/x-abiword",
  arc: "application/x-freearc",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  flac: "audio/flac",
  azw: "application/vnd.amazon.ebook",
  bin: "application/octet-stream",
  bz: "application/x-bzip",
  bz2: "application/x-bzip2",
  csh: "application/x-csh",
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  epub: "application/epub+zip",
  gif: "image/gif",
  html: "text/html",
  htm: "text/html",
  ts: "video/mp2t",
  ico: "image/vnd.microsoft.icon",
  ics: "text/calendar",
  jar: "application/java-archive",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mjs: "text/javascript",
  js: "text/javascript",
  json: "application/json",
  mid: "audio/midi",
  midi: "audio/midi",
  mpeg: "video/mpeg",
  mpkg: "application/vnd.apple.installer+xml",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  oga: "audio/ogg",
  ogv: "video/ogg",
  ogx: "application/ogg",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  rar: "application/vnd.rar",
  rtf: "application/rtf",
  sh: "application/x-sh",
  svg: "image/svg+xml",
  swf: "application/x-shockwave-flash",
  tar: "application/x-tar",
  tif: "image/tiff",
  tiff: "image/tiff",
  ttf: "font/ttf",
  vsd: "application/vnd.visio",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  xhtml: "application/xhtml+xml",
  xls: "application/vnd.ms-excel",
  xml: "application/xml",
  xul: "application/vnd.mozilla.xul+xml",
  zip: "application/zip",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  "7z": "application/x-7z-compressed",
  opf: "application/oebps-package+xml",
  txt: "text/plain",
  png: "image/png",
  apng: "image/apng",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  psd: "image/vnd.adobe.photoshop",
  pjp: "image/jpeg",
  cur: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  woff2: "font/woff2",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  md: "text/markdown",
  heic: "image/heic",
  heif: "image/heif",
  opus: "audio/opus",
  jsonld: "application/ld+json",
  php: "application/x-httpd-php",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  indd: "application/x-indesign",
  ncx: "application/x-dtbncx+xml",
};

class SvgTongListClass {
  public list: string[];
  constructor() {
    this.list = [];
  }
  add = (str: string): void => {
    this.list.push(str);
  };
}

class SvgTongHtmlParsingClass {
  public attribute: Record<string, string>;
  public src: string;
  public id: string;
  public style: Record<string, string>;
  public events: Array<{ name: string; callback: (event: Event) => void }>;
  public classList: SvgTongListClass;

  constructor() {
    this.attribute = {};
    this.src = "";
    this.id = "";
    this.style = {};
    this.events = [];
    this.classList = new SvgTongListClass();
  }

  public setAttribute = (key: string, value: string): void => {
    this.attribute[key] = value;
  };

  public getAttribute = (key: string): string => {
    return this.attribute[key];
  };

  public addEventListener = (eventName: string, callback: (event: Event) => void): void => {
    const obj: { name: string; callback: (event: Event) => void } = {
      name: eventName,
      callback: callback,
    };
    this.events.push(obj);
  };
}

class SvgDom {
  public source: SVGElement;
  public classList: SvgDomClassList;
  public stringSource: string;

  constructor(str: string) {
    const resultDom = new DOMParser().parseFromString(str, "image/svg+xml");
    const children: HTMLCollection = resultDom.children;
    const target = children[0] as SVGElement;
    this.source = target;
    this.classList = new SvgDomClassList(target);
    this.stringSource = str;
  }

  public getAttribute(key: string) {
    return this.source.getAttribute(key);
  }

  public setAttribute(key: string, value: string) {
    this.source.setAttribute(key, value);
  }

  public setId(id: string) {
    this.source.id = id;
  }

  public getRatio(): number {
    let viewBoxString: string;
    let viewBoxArr: Array<string>;

    viewBoxString = String(this.source.getAttribute("viewBox"));
    if (viewBoxString === "null") {
      return -1;
    }
    viewBoxArr = viewBoxString.split(" ");

    return Number(viewBoxArr[2]) / Number(viewBoxArr[3]);
  }

  public setStyle(key: string, value: string) {
    let thisStyleKey: any;
    thisStyleKey = key;
    this.source.style[thisStyleKey] = value;
  }

  public addEventListener(eventName: string, eventFunction: (e: any) => any) {
    this.source.addEventListener(eventName, eventFunction);
  }
}

class SvgDomClassList extends Array {
  public source: SVGElement;

  constructor(source: SVGElement) {
    super();
    this.source = source;
  }

  add(str: string) {
    this.push(str);
    this.source.classList.add(str);
  }
}

class SvgTong {
  constructor() {}

  public static tongMaker(): SvgTongHtmlParsingClass {
    let obj: SvgTongHtmlParsingClass = new SvgTongHtmlParsingClass();
    return obj;
  }

  public static stringParsing(str: string): SvgDom {
    return new SvgDom(str);
  }

  public static getRatio(svgString: string): number {
    let svgDom: SvgDom;
    let viewBoxString: string;
    let viewBoxArr: Array<string>;

    svgDom = SvgTong.stringParsing(svgString);

    viewBoxString = String(svgDom.getAttribute("viewBox"));
    if (viewBoxString === "null") {
      return -1;
    }
    viewBoxArr = viewBoxString.split(" ");

    return Number(viewBoxArr[2]) / Number(viewBoxArr[3]);
  }
}

export { DomStyle, DomEventHandler, DomEventMap, DomCommand, mimeTypes, SvgTong, SvgDom };
