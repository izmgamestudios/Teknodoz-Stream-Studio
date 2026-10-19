// src/lib/studio/transitions.ts
// WebGL runner for the open-source gl-transitions collection (MIT, https://gl-transitions.com).
export const NO_TRANSITION = "none";

/** Scene transition types backed by gl-transitions look like "gl:CrossZoom". */
export const GL_PREFIX = "gl:";
export const isGlTransition = (type: string): type is `gl:${string}` =>
  /^gl:[A-Za-z0-9_]{1,40}$/.test(type);
export const glName = (type: string) => type.slice(GL_PREFIX.length);

/** Curated, texture-free transitions: [gl-transitions name, Turkish label]. */
export const GL_TRANSITIONS: [string, string][] = [
  ["fade", "Çapraz geçiş"],
  ["wipeLeft", "Sola sil"],
  ["wipeRight", "Sağa sil"],
  ["wipeUp", "Yukarı sil"],
  ["circleopen", "Daire açılış"],
  ["CrossZoom", "Zoom patlaması"],
  ["directionalwarp", "Yönlü büküm"],
  ["crosswarp", "Çapraz büküm"],
  ["cube", "Küp dönüşü"],
  ["swap", "Yer değiştir"],
  ["doorway", "Kapı aralığı"],
  ["GlitchMemories", "Glitch"],
  ["Dreamy", "Rüya"],
  ["pixelize", "Pikselleş"],
  ["ripple", "Dalga"],
  ["windowslice", "Panjur"],
  ["burn", "Yanma"],
  ["Radial", "Radyal"],
  ["PolkaDotsCurtain", "Puantiye perde"],
  ["squeeze", "Sıkıştır"],
  ["hexagonalize", "Altıgen"],
  ["TVStatic", "TV paraziti"],
  ["WaterDrop", "Su damlası"],
  ["StarWipe", "Yıldız"],
  ["heart", "Kalp"],
  ["SimpleZoom", "Basit zoom"],
  ["fadecolor", "Siyaha geç"],
  ["rotate_scale_fade", "Dönerek küçül"],
];

type GLEntry = {
  name: string;
  glsl: string;
  textures: string[];
  paramsTypes: Record<string, string>;
  defaultParams: Record<string, number | boolean | number[]>;
};

const VERT = `attribute vec2 p; varying vec2 _uv;
void main(){ _uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const fragFor = (glsl: string) => `precision highp float;
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv){ return texture2D(from, uv); }
vec4 getToColor(vec2 uv){ return texture2D(to, uv); }
${glsl}
void main(){ gl_FragColor = transition(_uv); }`;

export type TransitionEngine = {
  /** Draws one frame of `name` into `canvas`; false if the transition is unusable. */
  render(
    name: string,
    from: TexImageSource,
    to: TexImageSource,
    progress: number,
    width: number,
    height: number,
  ): boolean;
  readonly canvas: HTMLCanvasElement;
  readonly available: string[];
  dispose(): void;
};

export async function createTransitionEngine(): Promise<TransitionEngine | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const gl = canvas.getContext("webgl", {
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) return null;

  const mod = (await import("gl-transitions")) as unknown as {
    default?: GLEntry[];
  } & GLEntry[];
  const entries: GLEntry[] = mod.default ?? mod;
  const byName = new Map(entries.map((e) => [e.name, e]));

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const mkTex = (unit: number) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  mkTex(0);
  mkTex(1);

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };

  const programs = new Map<string, WebGLProgram | null>();
  const getProgram = (name: string) => {
    if (programs.has(name)) return programs.get(name)!;
    const e = byName.get(name);
    let prog: WebGLProgram | null = null;
    if (e && e.textures.length === 0) {
      const vs = compile(gl.VERTEX_SHADER, VERT),
        fs = compile(gl.FRAGMENT_SHADER, fragFor(e.glsl));
      if (vs && fs) {
        const p = gl.createProgram()!;
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, "p");
        gl.linkProgram(p);
        if (gl.getProgramParameter(p, gl.LINK_STATUS)) prog = p;
      }
    }
    programs.set(name, prog);
    return prog;
  };

  const setParams = (prog: WebGLProgram, e: GLEntry) => {
    for (const [key, val] of Object.entries(e.defaultParams)) {
      const loc = gl.getUniformLocation(prog, key);
      if (!loc) continue;
      const type = e.paramsTypes[key] ?? "float";
      const arr = Array.isArray(val) ? val : [Number(val)];
      if (type === "float") gl.uniform1f(loc, arr[0] ?? 0);
      else if (type === "int" || type === "bool")
        gl.uniform1i(loc, arr[0] ?? 0);
      else if (type === "vec2") gl.uniform2fv(loc, arr);
      else if (type === "vec3") gl.uniform3fv(loc, arr);
      else if (type === "vec4") gl.uniform4fv(loc, arr);
      else if (type === "ivec2") gl.uniform2iv(loc, arr);
      else if (type === "ivec3") gl.uniform3iv(loc, arr);
    }
  };

  const available = GL_TRANSITIONS.map(([n]) => n).filter((n) => getProgram(n));

  return {
    canvas,
    available,
    render(name, from, to, progress, width, height) {
      const prog = getProgram(name);
      const e = byName.get(name);
      if (!prog || !e) return false;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from);
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, to);
      gl.uniform1i(gl.getUniformLocation(prog, "from"), 0);
      gl.uniform1i(gl.getUniformLocation(prog, "to"), 1);
      gl.uniform1f(gl.getUniformLocation(prog, "progress"), progress);
      gl.uniform1f(gl.getUniformLocation(prog, "ratio"), width / height);
      setParams(prog, e);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
