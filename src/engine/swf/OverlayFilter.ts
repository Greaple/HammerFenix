import { defaultFilterVert, Filter, GlProgram, Texture } from 'pixi.js';

const fragment = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBackTexture;

float overlay(float cb, float cs) {
    return cb <= 0.5 ? 2.0 * cs * cb : 1.0 - 2.0 * (1.0 - cs) * (1.0 - cb);
}

void main(void)
{
    vec4 src = texture(uTexture, vTextureCoord);
    vec4 dst = texture(uBackTexture, vTextureCoord);
    vec3 cs = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
    vec3 cb = dst.a > 0.0 ? dst.rgb / dst.a : vec3(0.0);
    vec3 b = vec3(overlay(cb.r, cs.r), overlay(cb.g, cs.g), overlay(cb.b, cs.b));
    // Separable blend, premultiplied: the parts each one covers alone, then the blend where both do
    vec3 rgb = (1.0 - dst.a) * src.rgb + (1.0 - src.a) * dst.rgb + src.a * dst.a * b;
    finalColor = vec4(rgb, src.a + dst.a * (1.0 - src.a));
}
`;

/**
 * Flash `BlendMode.OVERLAY`: the clip screens the light parts of what lies under it and
 * multiplies the dark ones (the backdrop decides which). A filter that reads the backdrop, so the
 * renderer needs `useBackBuffer`. At the resolution of the surface it draws on, so the backdrop
 * copy and the clip line up. WebGL only (the renderer's default).
 */
export class OverlayFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'flash-overlay' }),
      resources: { uBackTexture: Texture.EMPTY },
      blendRequired: true,
      resolution: 'inherit',
      antialias: 'inherit',
    });
  }
}
