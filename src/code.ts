// Search selection for rectangle

import { Parser, Expression } from "expr-eval";
import { zip, map, range, isEqual } from "underscore";

interface InputNodes {
  // This is required, others are optional
  function: TextNode;
  placeholder?: RectangleNode;
  minDomainLabel?: TextNode;
  maxDomainLabel?: TextNode;
  minRangeLabel?: TextNode;
  maxRangeLabel?: TextNode;
}

interface InputValues {
  function: Expression;
  rect: BoundingBox;
  minDomain: number;
  maxDomain: number;
  minRange: number;
  maxRange: number;
}

const inset = 0.1;
interface LUTEntry {
  key: keyof InputNodes;
  type: NodeType;
  position: { x: number; y: number };
}

const lookupData: Array<LUTEntry> = [
  { key: "function", type: "TEXT", position: { x: 0.5, y: 1.0 } },
  { key: "placeholder", type: "RECTANGLE", position: { x: 0.5, y: 0.5 } },
  { key: "minDomainLabel", type: "TEXT", position: { x: 0.0, y: 1.0 } },
  { key: "maxDomainLabel", type: "TEXT", position: { x: 1.0 - inset, y: 1.0 } },
  { key: "minRangeLabel", type: "TEXT", position: { x: 1.0, y: 0.0 } },
  { key: "maxRangeLabel", type: "TEXT", position: { x: 1.0, y: 1.0 - inset } }
];

interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function getCenter(n: BoundingBox) {
  return { x: n.x + 0.5 * n.width, y: n.y + 0.5 * n.height };
}

function getBoundingBox(
  nodes: LayoutMixin | readonly SceneNode[]
): BoundingBox {
  if (Array.isArray(nodes)) {
    const union = (a, b) => {
      const { x: xa, y: ya, width: wa, height: ha } = a;
      const { x: xb, y: yb, width: wb, height: hb } = b;
      if (xa === Infinity || wa === -Infinity) {
        return b;
      }
      if (xb === Infinity || wb === -Infinity) {
        return a;
      }
      const x = Math.min(xa, xb);
      const y = Math.min(ya, yb);
      const width = Math.max(xa + wa - x, xb + wb - x);
      const height = Math.max(ya + ha - y, yb + hb - y);
      return { x, y, width, height };
    };
    return nodes.reduce(union, {
      x: Infinity,
      y: Infinity,
      width: 0,
      height: 0
    });
  } else {
    const { x, y, width, height } = nodes as LayoutMixin;
    return { x, y, width, height };
  }
}

function findInputs(nodes: readonly SceneNode[]): InputNodes | undefined {
  // Take the overall bounding box
  const bb = getBoundingBox(nodes);
  console.log("bounding box: ", bb);
  let inputs: Partial<InputNodes> = {};
  lookupData.forEach(({ key, position: targetPosition, type }) => {
    nodes.forEach(n => {
      const center = getCenter(n);
      const relativePosition = {
        x: (center.x - bb.x) / bb.width,
        y: (center.y - bb.y) / bb.height
      };
      const d = {
        x: relativePosition.x - targetPosition.x,
        y: relativePosition.y - targetPosition.y
      };
      const dist = Math.sqrt(d.x * d.x + d.y * d.y);
      if (dist < inset && n.type == type) {
        // @ts-ignore
        inputs[key] = n;
      }
    });
  });

  if (typeof inputs.function == "object") {
    return inputs as InputNodes;
  } else {
    return undefined;
  }
}

const parser = new Parser();
// Support both capitalizations
parser.consts.pi = Math.PI;
parser.consts.π = Math.PI;
parser.consts.e = Math.E;

// function* range(n) {
//   for (var i = 0; i < n; i++) yield i;
// }

function parseInputs(inputs: InputNodes) {
  let fnExpr;
  try {
    fnExpr = parser.parse(inputNodes.function.characters);
  } catch (e) {
    return undefined;
  }

  const parseNumeric = (input: TextNode) => {
    if (input !== undefined) {
      return parser.evaluate(input.characters);
    }
    return undefined;
  };

  // Get bounding box of nodes actually used
  const bb = getBoundingBox(Object.values(inputs));

  // Area to fill in. If missing, just pick a silly area
  const rect = getBoundingBox(inputs.placeholder) || {
    x: bb.x,
    y: bb.y,
    width: bb.width * (1 - inset),
    height: bb.height * (1 - inset)
  };

  const minDomain = parseNumeric(inputs.minDomainLabel);
  const maxDomain = parseNumeric(inputs.maxDomainLabel);
  const minRange = parseNumeric(inputs.minRangeLabel);
  const maxRange = parseNumeric(inputs.maxRangeLabel);

  return {
    function: fnExpr,
    rect,
    minDomain,
    maxDomain,
    minRange,
    maxRange
  };
}

function generateGraph(inputs: InputValues): VectorNetwork | undefined {
  // # of samples per pixel
  const { rect, function: fn } = inputs;
  let { minDomain = 0, maxDomain = 1, minRange, maxRange } = inputs;
  const resolution = 0.5;
  const npoints = Math.ceil(rect.width * resolution + 1);
  if (npoints < 3) {
    return undefined;
  }
  const iter = range(npoints);
  const domain = map(iter, i => minDomain + i / (maxDomain - minDomain));
  const values = map(domain, x => fn.evaluate({ x }));

  // Update range if not provided
  minRange = minRange || Math.min(...values);
  maxRange = maxRange || Math.max(...values);

  const xs = [...iter].map(i => i / resolution);
  const ys = values.map(
    v => rect.height * ((v - minRange) / (maxRange - minRange))
  );

  // Create objects from x/y arrays
  const vertices = map(zip(xs, ys), ([x, y]) => ({ x, y }));
  const segments = [
    ...map(range(vertices.length - 1), i => ({ start: i, end: i + 1 }))
  ];
  return {
    vertices,
    segments
  };
}

const autoupdate = true;

const inputNodes = findInputs(figma.currentPage.selection);
let inputs = parseInputs(inputNodes);

const graphNetwork = generateGraph(inputs);
if (graphNetwork !== undefined) {
  const outputNode = figma.createVector();
  outputNode.x = inputs.rect.x;
  outputNode.y = inputs.rect.y;
  outputNode.name = `Graph of ${inputNodes.function.characters}`;
  outputNode.vectorNetwork = graphNetwork;
  outputNode.strokeWeight = 3;

  // Auto-update
  if (autoupdate) {
    setInterval(() => {
      const newInputs = parseInputs(inputNodes);
      if (newInputs !== undefined && !isEqual(inputs, newInputs)) {
        inputs = newInputs;
        outputNode.vectorNetwork = generateGraph(inputs);
      }
    }, 1000);
  } else {
    figma.closePlugin();
  }
}
