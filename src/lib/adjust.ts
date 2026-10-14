// Non-AI tone and color adjustments, computed in the browser. Each control runs from -100 to 100, and 0 changes nothing.
export type AdjustControl = { key: AdjustKey; label: string; low: string; high: string };
export type AdjustKey = 'brightness' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'temperature' | 'tint' | 'vibrance' | 'saturation';
export type AdjustValues = Record<AdjustKey, number>;

export const lightControls: AdjustControl[] = [
  { key: 'brightness', label: 'Brightness', low: 'Darker', high: 'Brighter' },
  { key: 'contrast', label: 'Contrast', low: 'Flatter', high: 'Punchier' },
  { key: 'highlights', label: 'Highlights', low: 'Recover', high: 'Brighten' },
  { key: 'shadows', label: 'Shadows', low: 'Deepen', high: 'Lift' },
  { key: 'whites', label: 'Whites', low: 'Lower', high: 'Raise' },
  { key: 'blacks', label: 'Blacks', low: 'Deepen', high: 'Lift' },
];
export const colorControls: AdjustControl[] = [
  { key: 'temperature', label: 'Temperature', low: 'Cool', high: 'Warm' },
  { key: 'tint', label: 'Tint', low: 'Green', high: 'Magenta' },
  { key: 'vibrance', label: 'Vibrance', low: 'Muted', high: 'Vivid' },
  { key: 'saturation', label: 'Saturation', low: 'Gray', high: 'Vivid' },
];
export const adjustControls = [...lightControls, ...colorControls];

export const defaultAdjust = (): AdjustValues => Object.fromEntries(adjustControls.map(c => [c.key, 0])) as AdjustValues;
export const isIdentity = (values: AdjustValues) => adjustControls.every(c => !values[c.key]);

// Labels such as "Brightness +20" for every control that is not 0.
export function changedAdjustments(values: AdjustValues): string[] {
  return adjustControls.filter(c => values[c.key]).map(c => `${c.label} ${values[c.key] > 0 ? '+' : ''}${values[c.key]}`);
}

// The adjustments run as a WebGL2 fragment shader. Tone controls move a pixel's luminance and shift all three
// channels by the same amount, so hues stay put. Each tone control is weighted to its own range of brightness.
const vertexShader = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  // Image rows are uploaded top first, so v is flipped to keep the top of the image at the top.
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec3 gain;
uniform float gamma, contrast, highlights, shadows, whites, blacks, saturation, vibrance;
in vec2 uv;
out vec4 color;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec4 source = texture(image, uv);
  // Temperature and tint are channel gains, and brightness is a gamma curve.
  vec3 c = source.rgb * gain;
  if (gamma != 1.0) c = pow(clamp(c, 0.0, 1.0), vec3(gamma));
  float before = luma(c), l = before;
  l = 0.5 + (l - 0.5) * contrast;
  l += 0.3 * highlights * smoothstep(0.5, 1.0, l);
  l += 0.3 * shadows * (1.0 - smoothstep(0.0, 0.5, l));
  l += 0.25 * whites * smoothstep(0.7, 1.0, l);
  l += 0.25 * blacks * (1.0 - smoothstep(0.0, 0.3, l));
  c += l - before;
  // Saturation scales every color's distance from gray. Vibrance does the same, weighted towards dull colors.
  float gray = luma(c), chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float scale = max(0.0, (1.0 + saturation) * (1.0 + vibrance * (1.0 - clamp(chroma, 0.0, 1.0))));
  color = vec4(clamp(vec3(gray) + (c - vec3(gray)) * scale, 0.0, 1.0), source.a);
}`;

// The shader inputs for a set of control values.
export function shaderUniforms(values: AdjustValues) {
  const v = Object.fromEntries(adjustControls.map(c => [c.key, (values[c.key] ?? 0) / 100])) as AdjustValues;
  return {
    // Temperature trades red against blue. Tint trades green against red and blue (magenta).
    gain: [(1 + 0.2 * v.temperature) * (1 + 0.08 * v.tint), 1 - 0.15 * v.tint, (1 - 0.2 * v.temperature) * (1 + 0.08 * v.tint)],
    gamma: 2 ** -v.brightness,
    contrast: v.contrast >= 0 ? 1 + v.contrast : 1 + v.contrast * 0.7,
    highlights: v.highlights, shadows: v.shadows, whites: v.whites, blacks: v.blacks, saturation: v.saturation, vibrance: v.vibrance,
  };
}

type Source = ImageBitmap | ImageData | OffscreenCanvas;

// One WebGL2 context, shared by every adjusted image, drawing into an offscreen canvas.
export class GpuAdjuster {
  readonly canvas = new OffscreenCanvas(1, 1);
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures = new Map<Source, WebGLTexture>();

  constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('Adjust needs WebGL2, which this browser does not provide.');
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Adjust shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Adjust shader failed to link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);
    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  // Uploads each source once and keeps the most recent on the GPU, so slider moves only redraw.
  texture(source: Source): WebGLTexture {
    const gl = this.gl;
    let texture = this.textures.get(source);
    if (texture) return texture;
    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    this.textures.set(source, texture);
    if (this.textures.size > 8) {
      const [oldest, old] = this.textures.entries().next().value!;
      gl.deleteTexture(old);
      this.textures.delete(oldest);
    }
    return texture;
  }

  // Draws the adjusted source into the canvas at the source's size.
  draw(source: Source, values: AdjustValues): void {
    const gl = this.gl;
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    gl.viewport(0, 0, source.width, source.height);
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(source));
    const u = shaderUniforms(values), at = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniform3fv(at('gain'), u.gain);
    for (const name of ['gamma', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance'] as const) gl.uniform1f(at(name), u[name]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The last drawn image as RGBA rows, top row first.
  pixels(): Uint8ClampedArray {
    const gl = this.gl, { width, height } = this.canvas;
    const raw = new Uint8Array(width * height * 4), out = new Uint8ClampedArray(raw.length), row = width * 4;
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  }
}

let shared: GpuAdjuster | undefined;
export const gpuAdjuster = () => (shared ??= new GpuAdjuster());

// Full renders feed AI runs and the viewer. Cards show previews, which are fast enough to redraw on every slider move.
export const adjustLongSide = 2048;
export const previewLongSide = 640;

// Decoded inputs, scaled to at most a long side, kept per input and size so slider moves skip decoding.
const decoded = new WeakMap<Blob, Map<number, Promise<ImageBitmap>>>();
// The same inputs once decoded, so a live draw can use them without waiting.
const ready = new WeakMap<Blob, Map<number, ImageBitmap>>();
function decode(blob: Blob, longSide: number): Promise<ImageBitmap> {
  const sizes = decoded.get(blob) ?? new Map<number, Promise<ImageBitmap>>();
  decoded.set(blob, sizes);
  let bitmap = sizes.get(longSide);
  if (!bitmap) {
    bitmap = (async () => {
      const full = await createImageBitmap(blob);
      const scale = Math.min(1, longSide / Math.max(full.width, full.height));
      if (scale === 1) return full;
      const scaled = await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: 'high' });
      full.close();
      return scaled;
    })();
    bitmap.then(done => { const sizes = ready.get(blob) ?? new Map<number, ImageBitmap>(); ready.set(blob, sizes); sizes.set(longSide, done); }, () => sizes.delete(longSide));
    sizes.set(longSide, bitmap);
  }
  return bitmap;
}

// Decodes an input and uploads it to the GPU ahead of the first slider move.
export async function prepareAdjust(blob: Blob, longSide = previewLongSide): Promise<void> {
  gpuAdjuster().texture(await decode(blob, longSide));
}

// Draws an adjusted preview straight into a canvas on the page, synchronously. Returns false when the input is not
// decoded yet; it is then decoded in the background, and the caller can draw again when `prepareAdjust` resolves.
export function drawAdjusted(target: HTMLCanvasElement, blob: Blob, values: AdjustValues): boolean {
  const source = ready.get(blob)?.get(previewLongSide);
  if (!source) { decode(blob, previewLongSide).catch(() => {}); return false; }
  const gpu = gpuAdjuster();
  gpu.draw(source, values);
  if (target.width !== source.width || target.height !== source.height) { target.width = source.width; target.height = source.height; }
  (target.getContext('bitmaprenderer') as ImageBitmapRenderingContext).transferFromImageBitmap(gpu.canvas.transferToImageBitmap());
  return true;
}

// Renders an adjusted copy of an image on the GPU, as a JPEG of at most `longSide`.
export async function renderAdjusted(blob: Blob, values: AdjustValues, longSide = adjustLongSide): Promise<{ blob: Blob; width: number; height: number }> {
  const source = await decode(blob, longSide), gpu = gpuAdjuster();
  // convertToBlob copies the canvas when it is called, so another draw cannot slip in between.
  gpu.draw(source, values);
  return { blob: await gpu.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), width: source.width, height: source.height };
}
