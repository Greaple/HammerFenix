import {
  defaultFilterVert,
  Filter,
  type FilterSystem,
  GlProgram,
  type RenderSurface,
  type Texture,
  TexturePool,
  UniformGroup,
} from 'pixi.js';

/** Most samples per pass: a wide blur is sampled more sparsely, with linear filtering between. */
const MAX_SAMPLES = 64;

const fragment = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform vec2 uDir;
uniform float uBlur;
uniform float uSamples;

void main(void)
{
    vec4 sum = vec4(0.0);
    for (int k = 0; k < ${MAX_SAMPLES}; k++) {
        if (float(k) >= uSamples) break;
        float t = (float(k) + 0.5) / uSamples - 0.5;
        vec2 off = uDir * t * uBlur * uInputSize.zw;
        sum += texture(uTexture, clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw));
    }
    finalColor = sum / uSamples;
}
`;

/** One axis of `BoxBlurFilter`: the average over a box `blur` pixels wide. */
class BoxBlurPass extends Filter {
  blur = 0;

  constructor(dir: [number, number]) {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'flash-box-blur' }),
      resources: {
        boxUniforms: new UniformGroup({
          uDir: { value: new Float32Array(dir), type: 'vec2<f32>' },
          uBlur: { value: 0, type: 'f32' },
          uSamples: { value: 1, type: 'f32' },
        }),
      },
    });
  }

  override apply(fm: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const u = (this.resources.boxUniforms as UniformGroup).uniforms;
    const px = this.blur * input.source.resolution;
    u.uBlur = px;
    u.uSamples = Math.max(1, Math.min(MAX_SAMPLES, Math.ceil(px)));
    fm.applyFilter(this, input, output, clear);
  }
}

/**
 * Flash `flash.filters.BlurFilter`: a box blur `blurX` x `blurY` pixels, `quality` times (Flash's
 * default 1). Each pass blurs one axis. At the resolution of the surface it draws on. WebGL only
 * (the renderer's default).
 */
export class BoxBlurFilter extends Filter {
  private readonly passX = new BoxBlurPass([1, 0]);
  private readonly passY = new BoxBlurPass([0, 1]);

  constructor(
    blurX: number,
    blurY: number,
    readonly quality = 1,
  ) {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'flash-box-blur' }),
      resolution: 'inherit',
      antialias: 'inherit',
    });
    this.setBlur(blurX, blurY);
  }

  setBlur(blurX: number, blurY: number): void {
    this.passX.blur = Math.max(0, blurX);
    this.passY.blur = Math.max(0, blurY);
    // Room for half the box on each side, per pass
    this.padding = Math.ceil((Math.max(this.passX.blur, this.passY.blur) / 2) * this.quality);
  }

  override apply(fm: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const passes: BoxBlurPass[] = [];
    for (let i = 0; i < this.quality; i++) {
      if (this.passX.blur > 0) passes.push(this.passX);
      if (this.passY.blur > 0) passes.push(this.passY);
    }
    if (passes.length === 0) {
      fm.applyFilter(this.passX, input, output, clear);
      return;
    }
    let src = input;
    let tmp: Texture | null = null;
    for (let i = 0; i < passes.length; i++) {
      const last = i === passes.length - 1;
      passes[i].blendMode = last ? this.blendMode : 'normal';
      if (last) {
        passes[i].apply(fm, src, output, clear);
      } else {
        const next = TexturePool.getSameSizeTexture(input);
        passes[i].apply(fm, src, next, true);
        if (tmp) TexturePool.returnTexture(tmp);
        tmp = next;
        src = next;
      }
    }
    if (tmp) TexturePool.returnTexture(tmp);
  }
}
