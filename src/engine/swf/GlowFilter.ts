import {
  defaultFilterVert,
  Filter,
  type FilterSystem,
  GlProgram,
  type RenderSurface,
  type Texture,
  UniformGroup,
} from 'pixi.js';

/** Grid of alpha samples on each side of the pixel (a 13 x 13 box). */
const N = 6;

// highp: `uInputSize` is shared with the vertex shader, and the precisions must match to link
const fragment = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform vec3 uColor;
uniform float uAlpha;
uniform vec2 uBlur;
uniform float uStrength;

void main(void)
{
    vec4 src = texture(uTexture, vTextureCoord);
    float sum = 0.0;
    for (int i = -${N}; i <= ${N}; i++) {
        for (int j = -${N}; j <= ${N}; j++) {
            vec2 off = vec2(float(i), float(j)) / ${N}.0 * 0.5 * uBlur * uInputSize.zw;
            sum += texture(uTexture, clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw)).a;
        }
    }
    float a = clamp(sum / ${(2 * N + 1) * (2 * N + 1)}.0 * uStrength, 0.0, 1.0) * uAlpha;
    finalColor = src + vec4(uColor * a, a) * (1.0 - src.a);
}
`;

/**
 * Flash `flash.filters.GlowFilter` (outer glow, quality 1): the clip's alpha, box-blurred over
 * `blurX` x `blurY` pixels and multiplied by `strength`, drawn in `color` under the clip.
 * WebGL only (the renderer's default).
 */
export class GlowFilter extends Filter {
  /** Blur in stage pixels, as Flash measures it. */
  blurX = 6;
  blurY = 6;

  constructor() {
    const uniforms = new UniformGroup({
      uColor: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
      uAlpha: { value: 1, type: 'f32' },
      uBlur: { value: new Float32Array([6, 6]), type: 'vec2<f32>' },
      uStrength: { value: 2, type: 'f32' },
    });
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'flash-glow' }),
      resources: { glowUniforms: uniforms },
      // Room for a blur of up to 20 px
      padding: 12,
    });
  }

  private get u(): Record<string, unknown> {
    return (this.resources.glowUniforms as UniformGroup).uniforms;
  }

  set color(hex: number) {
    const c = this.u.uColor as Float32Array;
    c[0] = ((hex >> 16) & 0xff) / 255;
    c[1] = ((hex >> 8) & 0xff) / 255;
    c[2] = (hex & 0xff) / 255;
  }

  set alpha(v: number) {
    this.u.uAlpha = v;
  }

  set strength(v: number) {
    this.u.uStrength = v;
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    // The filter texture is at the renderer's resolution: convert the blur to its pixels.
    const res = input.source.resolution;
    const b = this.u.uBlur as Float32Array;
    b[0] = this.blurX * res;
    b[1] = this.blurY * res;
    filterManager.applyFilter(this, input, output, clearMode);
  }
}
