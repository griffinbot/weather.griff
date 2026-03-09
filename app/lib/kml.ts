export type KmlFeatureKind = "point" | "line" | "polygon";

export interface KmlStyleDefinition {
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
}

export interface KmlFeature {
  id: string;
  name: string;
  kind: KmlFeatureKind;
  positions: Array<[number, number]>;
  style: KmlStyleDefinition;
}

export interface ParsedKmlDocument {
  sourceName: string;
  documentName: string;
  features: KmlFeature[];
}

const DEFAULT_STYLE: KmlStyleDefinition = {
  strokeColor: "#16a34a",
  strokeOpacity: 0.95,
  strokeWidth: 2,
  fillColor: "#22c55e",
  fillOpacity: 0.18,
};

function firstDescendantText(
  parent: Element | Document,
  localName: string,
): string | null {
  const match = parent.getElementsByTagNameNS("*", localName)[0];
  return match?.textContent?.trim() || null;
}

function childElements(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(
    (child): child is Element => child.localName === localName,
  );
}

function parseKmlColor(value: string | null | undefined): {
  color: string;
  opacity: number;
} | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(cleaned)) return null;

  const alpha = Number.parseInt(cleaned.slice(0, 2), 16) / 255;
  const blue = cleaned.slice(2, 4);
  const green = cleaned.slice(4, 6);
  const red = cleaned.slice(6, 8);

  return {
    color: `#${red}${green}${blue}`,
    opacity: Number(alpha.toFixed(3)),
  };
}

function parseStyleElement(element: Element): Partial<KmlStyleDefinition> {
  const style: Partial<KmlStyleDefinition> = {};

  const lineStyle = element.getElementsByTagNameNS("*", "LineStyle")[0];
  if (lineStyle) {
    const parsedColor = parseKmlColor(firstDescendantText(lineStyle, "color"));
    if (parsedColor) {
      style.strokeColor = parsedColor.color;
      style.strokeOpacity = parsedColor.opacity;
    }

    const width = Number.parseFloat(firstDescendantText(lineStyle, "width") || "");
    if (Number.isFinite(width) && width > 0) {
      style.strokeWidth = width;
    }
  }

  const polyStyle = element.getElementsByTagNameNS("*", "PolyStyle")[0];
  if (polyStyle) {
    const parsedColor = parseKmlColor(firstDescendantText(polyStyle, "color"));
    if (parsedColor) {
      style.fillColor = parsedColor.color;
      style.fillOpacity = parsedColor.opacity;
    }
  }

  return style;
}

function mergeStyle(
  baseStyle: KmlStyleDefinition,
  overrideStyle?: Partial<KmlStyleDefinition>,
): KmlStyleDefinition {
  return {
    strokeColor: overrideStyle?.strokeColor ?? baseStyle.strokeColor,
    strokeOpacity: overrideStyle?.strokeOpacity ?? baseStyle.strokeOpacity,
    strokeWidth: overrideStyle?.strokeWidth ?? baseStyle.strokeWidth,
    fillColor: overrideStyle?.fillColor ?? baseStyle.fillColor,
    fillOpacity: overrideStyle?.fillOpacity ?? baseStyle.fillOpacity,
  };
}

function parseCoordinates(text: string | null | undefined): Array<[number, number]> {
  if (!text) return [];

  return text
    .trim()
    .split(/\s+/)
    .map((chunk) => {
      const [lonText, latText] = chunk.split(",");
      const lon = Number.parseFloat(lonText);
      const lat = Number.parseFloat(latText);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return [lat, lon] as [number, number];
    })
    .filter((value): value is [number, number] => value !== null);
}

function resolveStyleUrl(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^#/, "") || null;
}

export function parseKmlDocument(
  xmlText: string,
  sourceName = "Uploaded KML",
): ParsedKmlDocument {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const parserError = xml.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("The uploaded file is not valid KML/XML.");
  }

  const namedDocument = xml.getElementsByTagNameNS("*", "Document")[0];
  const documentName =
    firstDescendantText(namedDocument ?? xml, "name") || sourceName;

  const styles = new Map<string, KmlStyleDefinition>();
  Array.from(xml.getElementsByTagNameNS("*", "Style")).forEach((styleElement) => {
    const id = styleElement.getAttribute("id");
    if (!id) return;
    styles.set(id, mergeStyle(DEFAULT_STYLE, parseStyleElement(styleElement)));
  });

  const styleMaps = new Map<string, string>();
  Array.from(xml.getElementsByTagNameNS("*", "StyleMap")).forEach((styleMapEl) => {
    const id = styleMapEl.getAttribute("id");
    if (!id) return;

    const normalPair = childElements(styleMapEl, "Pair").find((pair) => {
      const key = firstDescendantText(pair, "key");
      return key === "normal";
    });
    const styleUrl = resolveStyleUrl(firstDescendantText(normalPair ?? styleMapEl, "styleUrl"));
    if (styleUrl) styleMaps.set(id, styleUrl);
  });

  const features: KmlFeature[] = [];

  Array.from(xml.getElementsByTagNameNS("*", "Placemark")).forEach((placemark, placemarkIndex) => {
    const placemarkName =
      firstDescendantText(placemark, "name") || `Feature ${placemarkIndex + 1}`;

    const inlineStyle = placemark.getElementsByTagNameNS("*", "Style")[0];
    const inlineStyleDef = inlineStyle ? parseStyleElement(inlineStyle) : undefined;

    const styleUrl = resolveStyleUrl(firstDescendantText(placemark, "styleUrl"));
    const mappedStyleId = styleUrl ? styleMaps.get(styleUrl) ?? styleUrl : null;
    const resolvedStyle = mergeStyle(
      styles.get(mappedStyleId ?? "") ?? DEFAULT_STYLE,
      inlineStyleDef,
    );

    const pointElements = Array.from(placemark.getElementsByTagNameNS("*", "Point"));
    pointElements.forEach((point, geometryIndex) => {
      const positions = parseCoordinates(firstDescendantText(point, "coordinates"));
      if (positions.length === 0) return;
      features.push({
        id: `${placemarkIndex}-point-${geometryIndex}`,
        name: placemarkName,
        kind: "point",
        positions: [positions[0]],
        style: resolvedStyle,
      });
    });

    const lineElements = Array.from(
      placemark.getElementsByTagNameNS("*", "LineString"),
    );
    lineElements.forEach((line, geometryIndex) => {
      const positions = parseCoordinates(firstDescendantText(line, "coordinates"));
      if (positions.length < 2) return;
      features.push({
        id: `${placemarkIndex}-line-${geometryIndex}`,
        name: placemarkName,
        kind: "line",
        positions,
        style: resolvedStyle,
      });
    });

    const polygonElements = Array.from(
      placemark.getElementsByTagNameNS("*", "Polygon"),
    );
    polygonElements.forEach((polygon, geometryIndex) => {
      const outerBoundary = polygon.getElementsByTagNameNS("*", "outerBoundaryIs")[0];
      const coordinates = firstDescendantText(
        outerBoundary ?? polygon,
        "coordinates",
      );
      const positions = parseCoordinates(coordinates);
      if (positions.length < 3) return;
      features.push({
        id: `${placemarkIndex}-polygon-${geometryIndex}`,
        name: placemarkName,
        kind: "polygon",
        positions,
        style: resolvedStyle,
      });
    });
  });

  return {
    sourceName,
    documentName,
    features,
  };
}
