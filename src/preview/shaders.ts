// 미리보기 셰이더. 각 공식은 내보내기 쪽 FFmpeg 필터(effects.ts / transitions.ts / exportPlan.ts)와 짝을 이룬다.
// 좌표 규칙: 모든 텍스처는 v=0이 위쪽(영상 첫 줄). 픽셀 좌표 px도 위쪽이 0.

export const FULL_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform float u_flipY;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  if (u_flipY > 0.5) v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex;
void main() { o = texture(u_tex, v_uv); }`;

// ── 레이어 ──────────────────────────────────────────────
export const LAYER_VS = `#version 300 es
in vec2 a_pos;            // -0.5..0.5 단위 사각형
uniform vec2 u_res;       // 캔버스 픽셀
uniform vec2 u_center;    // 픽셀
uniform vec2 u_size;      // 픽셀
uniform float u_rot;      // 라디안 (시계 방향 +)
out vec2 v_uv;
void main() {
  vec2 p = a_pos * u_size;
  float c = cos(u_rot), s = sin(u_rot);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + u_center;
  v_uv = a_pos + 0.5;
  gl_Position = vec4(p / u_res * 2.0 - 1.0, 0.0, 1.0);
}`;

export const LAYER_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_texel;      // 1 / 원본 텍스처 크기
uniform vec4 u_crop;       // l, t, r, b
uniform vec2 u_flip;
uniform float u_opacity;
uniform float u_sharpen;
uniform float u_vignette;
uniform vec2 u_srcSize;    // 잘라낸 원본 픽셀 크기
uniform int u_chroma;
uniform vec2 u_keyUV;      // 0..255
uniform float u_sim, u_blend;
uniform int u_hasLut;
uniform sampler3D u_lut;
uniform float u_lutN;
uniform int u_hasMask;
uniform sampler2D u_mask;

vec2 srcUV(vec2 uv) {
  uv = mix(uv, 1.0 - uv, u_flip);
  return u_crop.xy + uv * (1.0 - u_crop.xy - u_crop.zw);
}
vec2 toUV(vec3 c) { // FFmpeg RGB_TO_U/V_CCIR (BT.601 제한 범위)
  vec3 r = c * 255.0;
  return vec2(-0.148223 * r.r - 0.290993 * r.g + 0.439216 * r.b + 128.0,
               0.439216 * r.r - 0.367788 * r.g - 0.071427 * r.b + 128.0);
}
void main() {
  vec2 suv = srcUV(v_uv);
  vec4 c = texture(u_tex, suv);
  if (u_sharpen > 0.0) {
    vec3 b = vec3(0.0);
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) b += texture(u_tex, suv + vec2(x, y) * u_texel).rgb;
    b /= 25.0;
    c.rgb = clamp(c.rgb + u_sharpen * 2.5 * (c.rgb - b), 0.0, 1.0);
  }
  if (u_vignette > 0.0) {
    float dn = length((v_uv - 0.5) * u_srcSize) / length(0.5 * u_srcSize);
    float k = cos(u_vignette * 1.2 * dn);
    c.rgb *= dn > 1.0 ? 0.0 : k * k * k * k;
  }
  if (u_chroma == 1) {
    float diff = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 d = toUV(texture(u_tex, suv + vec2(x, y) * u_texel).rgb) - u_keyUV;
      diff += sqrt((d.x * d.x + d.y * d.y) / (255.0 * 255.0 * 2.0));
    }
    diff /= 9.0;
    float a = u_blend > 0.0001 ? clamp((diff - u_sim) / u_blend, 0.0, 1.0) : (diff > u_sim ? 1.0 : 0.0);
    c.a *= a;
  }
  if (u_hasLut == 1) c.rgb = texture(u_lut, c.rgb * (u_lutN - 1.0) / u_lutN + 0.5 / u_lutN).rgb;
  if (u_hasMask == 1) c.a *= texture(u_mask, v_uv).r;
  c.a *= u_opacity;
  o = c;
}`;

// ── 블렌드 모드 (A = 아래 화면, B = 레이어, FFmpeg blend 공식) ──
export const BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_base, u_layer;
uniform int u_mode;
vec3 f(vec3 A, vec3 B) {
  if (u_mode == 1) return A * B;
  if (u_mode == 2) return 1.0 - (1.0 - A) * (1.0 - B);
  if (u_mode == 3) return mix(1.0 - 2.0 * (1.0 - A) * (1.0 - B), 2.0 * A * B, step(A, vec3(0.5 - 1e-6)));
  if (u_mode == 4) return min(A, B);
  if (u_mode == 5) return max(A, B);
  if (u_mode == 6) return min(vec3(1.0), A + B);
  if (u_mode == 7) return abs(A - B);
  if (u_mode == 8) return A + B - 2.0 * A * B;
  return B;
}
void main() {
  vec4 A = texture(u_base, v_uv);
  vec4 B = texture(u_layer, v_uv);
  vec3 rgb = B.a > 0.0 ? B.rgb / B.a : vec3(0.0);
  o = vec4(mix(A.rgb, f(A.rgb, rgb * B.a), B.a), 1.0);
}`;

// ── 가우시안 블러 (2패스) ──
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_dir;    // 텍셀 단위 방향
uniform float u_sigma; // 픽셀
void main() {
  if (u_sigma < 0.3) { o = texture(u_tex, v_uv); return; }
  float radius = ceil(u_sigma * 3.0);
  float stepv = max(1.0, radius / 32.0);
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (float i = -radius; i <= radius; i += stepv) {
    float w = exp(-0.5 * i * i / (u_sigma * u_sigma));
    sum += texture(u_tex, v_uv + u_dir * i) * w;
    wsum += w;
  }
  o = sum / wsum;
}`;

// ── 효과 (화면 전체) ──
export const EFFECT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex, u_aux;
uniform int u_kind;
uniform vec2 u_res;
uniform float u_t, u_a, u_b, u_D, u_k; // u_k = 캔버스높이/1080
uniform vec3 u_col;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 S(vec2 uv) { return texture(u_tex, clamp(uv, 0.0, 1.0)); }
float luma601(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 sepia(vec3 c, float k) {
  mat3 m = mat3(0.393, 0.349, 0.272, 0.769, 0.686, 0.534, 0.189, 0.168, 0.131);
  return mix(c, clamp(m * c, 0.0, 1.0), k);
}
float vig(vec2 px, float angle) {
  float dn = length(px - u_res * 0.5) / length(u_res * 0.5);
  float k = cos(angle * dn);
  return dn > 1.0 ? 0.0 : k * k * k * k;
}
vec3 rgbShift(vec2 uv, float s) {
  vec2 d = vec2(s / u_res.x, 0.0);
  return vec3(S(uv - d).r, S(uv).g, S(uv + d).b);
}
vec3 hueRot(vec3 c, float deg) {
  float y = luma601(c);
  float u = (c.b - y) * 0.565, v = (c.r - y) * 0.713;
  float a = radians(deg), cs = cos(a), sn = sin(a);
  float u2 = u * cs - v * sn, v2 = u * sn + v * cs;
  return clamp(vec3(y + 1.403 * v2, y - 0.344 * u2 - 0.714 * v2, y + 1.770 * u2), 0.0, 1.0);
}
vec3 zoom(vec2 uv, float z) { return S(0.5 + (uv - 0.5) / z).rgb; }
void main() {
  vec2 uv = v_uv;
  vec2 px = uv * u_res;
  vec3 c = S(uv).rgb;
  float k = u_k;
  if (u_kind == 2) c *= vig(px, max(0.0001, u_a * 1.2));
  else if (u_kind == 3) c += (hash(px + fract(u_t) * 97.0) - 0.5) * 2.0 * (u_a * 40.0) / 255.0;
  else if (u_kind == 4) { float b = max(2.0, floor((4.0 + u_a * 60.0) * k + 0.5)); c = S((floor(px / b) + 0.5) * b / u_res).rgb; }
  else if (u_kind == 5) c = 1.0 - c;
  else if (u_kind == 6) { float L = floor(u_b + 0.5); c = floor(c * 255.0 / 256.0 * L) / (L - 1.0); }
  else if (u_kind == 7) { if (px.y < u_res.y * u_a || px.y > u_res.y - u_res.y * u_a) c = vec3(0.0); }
  else if (u_kind == 8) {
    vec3 b = vec3(0.0); vec2 tx = 1.0 / u_res;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) b += S(uv + vec2(x, y) * tx).rgb;
    c = clamp(c + u_a * 2.5 * (c - b / 25.0), 0.0, 1.0);
  }
  else if (u_kind == 10) {
    float z = 1.0 + 0.12 * u_a;
    vec2 off = (u_res * z - u_res) * 0.5 * (1.0 + vec2(sin(u_t * 53.0 * u_b), sin(u_t * 71.0 * u_b)));
    c = S((px + off) / (u_res * z)).rgb;
  }
  else if (u_kind == 11) c = zoom(uv, 1.0 + 0.25 * u_a * abs(sin(u_t * 3.14159265 * u_b)));
  else if (u_kind == 12) c = zoom(uv, 1.0 + 0.5 * u_a * u_t / max(0.1, u_D));
  else if (u_kind == 13) c = zoom(uv, 1.0 + 0.5 * u_a * (1.0 - u_t / max(0.1, u_D)));
  else if (u_kind == 14) {
    float z = 1.06;
    float jit = 0.5 * u_a * step(mod(u_t * 7.0, 1.0), 0.25 - 1e-6) * sin(u_t * 97.0) * 2.0;
    vec2 off = (u_res * z - u_res) * 0.5 * vec2(1.0 + jit, 1.0);
    vec2 suv = (px + off) / (u_res * z);
    float s = floor(u_a * 12.0 * k + 0.5);
    vec2 d = vec2(s / u_res.x, 0.0);
    c = vec3(S(suv - d).r, S(suv).g, S(suv + d).b);
    c += (hash(px + fract(u_t) * 51.0) - 0.5) * 2.0 * (u_a * 18.0) / 255.0;
  }
  else if (u_kind == 20) {
    c = rgbShift(uv, max(1.0, floor(u_a * 6.0 * k + 0.5)));
    c += (hash(px + fract(u_t) * 31.0) - 0.5) * 2.0 * (u_a * 16.0) / 255.0;
    float h = max(2.0, floor(4.0 * k + 0.5));
    if (mod(floor(px.y), h) < 1.0) c *= 1.0 - 0.35 * u_a;
  }
  else if (u_kind == 21) {
    c = sepia(c, u_a);
    c += (hash(px + fract(u_t) * 13.0) - 0.5) * 2.0 * (u_a * 25.0) / 255.0;
    c *= vig(px, 0.6 * u_a + 0.0001);
  }
  else if (u_kind == 22) c = rgbShift(uv, floor(u_a * 30.0 * k + 0.5));
  else if (u_kind == 23) { if (sin(u_t * 6.2831853 * u_b) < 0.0) c = vec3(luma601(c)); }
  else if (u_kind == 24) { float h = max(2.0, floor(3.0 * k + 0.5)); if (mod(floor(px.y), h) < 1.0) c *= 1.0 - 0.6 * u_a; }
  else if (u_kind == 30 || u_kind == 31) {
    vec2 tx = 1.0 / u_res;
    vec3 p00 = S(uv + tx * vec2(-1, -1)).rgb, p10 = S(uv + tx * vec2(0, -1)).rgb, p20 = S(uv + tx * vec2(1, -1)).rgb;
    vec3 p01 = S(uv + tx * vec2(-1, 0)).rgb, p11 = c, p21 = S(uv + tx * vec2(1, 0)).rgb;
    vec3 p02 = S(uv + tx * vec2(-1, 1)).rgb, p12 = S(uv + tx * vec2(0, 1)).rgb, p22 = S(uv + tx * vec2(1, 1)).rgb;
    if (u_kind == 30) {
      vec3 gx = -p00 - 2.0 * p01 - p02 + p20 + 2.0 * p21 + p22;
      vec3 gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;
      c = 1.0 - clamp(sqrt(gx * gx + gy * gy) * u_b, 0.0, 1.0);
      c = vec3(luma601(c));
    } else {
      c = clamp(-2.0 * p00 - p10 - p01 + p11 + p21 + p12 + 2.0 * p22, 0.0, 1.0);
    }
  }
  else if (u_kind == 32) c = S(vec2(uv.x < 0.5 ? uv.x : 1.0 - uv.x, uv.y)).rgb;
  else if (u_kind == 33) c = S(fract(uv * 2.0)).rgb;
  else if (u_kind == 34) c = hueRot(c, u_t * u_b);
  else if (u_kind == 35) c = luma601(c) * u_col;
  else if (u_kind == 1) c = texture(u_aux, uv).rgb;
  else if (u_kind == 40) { vec3 g = texture(u_aux, uv).rgb; c = c + (1.0 - (1.0 - c) * (1.0 - g) - c) * u_a; }
  else if (u_kind == 44) { vec3 g = texture(u_aux, uv).rgb; c = c + (max(c, g) - c) * u_a; }
  else if (u_kind == 41) c = clamp(c + u_a * pow(max(0.0, sin(u_t * 3.14159265 * u_b)), 8.0), 0.0, 1.0);
  else if (u_kind == 42) c *= clamp(u_t / max(0.001, u_D), 0.0, 1.0);
  else if (u_kind == 43) c *= 1.0 - clamp(u_t / max(0.001, u_D), 0.0, 1.0);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ── 전환 (P = 진행도 0..1, progress = 1-P 는 FFmpeg xfade 내부 표기) ──
// u_rect = 전환 영역(x, y, w, h 캔버스 픽셀). 메인 트랙은 화면 전체, 오버레이 트랙은 클립 영역.
// 오버레이는 미리 곱한 알파로 섞는다 (내보내기의 premultiply → xfade와 같음).
export const TRANSITION_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a, u_b;
uniform int u_kind;
uniform float u_p;
uniform vec2 u_res;
uniform vec4 u_rect;
vec4 S(sampler2D t, vec2 q) { return texture(t, clamp((u_rect.xy + q) / u_res, u_rect.xy / u_res, (u_rect.xy + u_rect.zw) / u_res)); }
vec4 A(vec2 q) { return S(u_a, q); }
vec4 B(vec2 q) { return S(u_b, q); }
float frand(vec2 p) { return fract(sin(p.x * 12.9898 + p.y * 78.233) * 43758.545); }
void main() {
  float progress = 1.0 - u_p;
  vec2 q = v_uv * u_res - u_rect.xy;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= u_rect.z || q.y >= u_rect.w) { o = vec4(0.0); return; }
  vec2 R = u_rect.zw;
  float W = R.x, H = R.y, x = q.x, y = q.y;
  vec4 a = A(q), b = B(q);
  vec4 r = mix(b, a, progress);
  if (u_kind == 2 || u_kind == 3) {
    vec4 k = u_kind == 2 ? vec4(0, 0, 0, 1) : vec4(1);
    vec4 i1 = mix(k, a, smoothstep(0.8, 1.0, progress));
    vec4 i2 = mix(b, k, smoothstep(0.2, 1.0, progress));
    r = mix(i2, i1, progress);
  }
  else if (u_kind == 4) r = frand(floor(q)) * 2.0 + progress * 2.0 - 1.5 >= 0.5 ? a : b;
  else if (u_kind == 5) {
    float d = min(progress, 1.0 - progress);
    float dist = ceil(d * 50.0) / 50.0;
    float sq = 2.0 * dist * min(W, H) / 20.0;
    vec2 sp = dist > 0.0 ? min((floor(q / sq) + 0.5) * sq, R - 1.0) : q;
    r = mix(B(sp), A(sp), progress);
  }
  else if (u_kind == 6) {
    float rad = floor(min(progress, 1.0 - progress) * 2.0 * W * 0.04);
    vec4 sa = vec4(0), sb = vec4(0); float n = 0.0;
    for (float i = -16.0; i <= 16.0; i += 1.0) { vec2 o2 = vec2(i * rad / 16.0, 0); sa += A(q + o2); sb += B(q + o2); n += 1.0; }
    r = mix(sb / n, sa / n, progress);
  }
  else if (u_kind == 7) {
    float zf = smoothstep(0.5, 1.0, progress);
    vec4 az = A(R * 0.5 + (q - R * 0.5) * zf);
    r = mix(b, az, smoothstep(0.0, 0.5, progress));
  }
  else if (u_kind == 10) r = x > W * progress ? b : a;
  else if (u_kind == 11) r = x > W * (1.0 - progress) ? a : b;
  else if (u_kind == 12) r = y > H * progress ? b : a;
  else if (u_kind == 13) r = y > H * (1.0 - progress) ? a : b;
  else if (u_kind == 14 || u_kind == 15) {
    float xx = u_kind == 14 ? x : W - 1.0 - x;
    float s = smoothstep(0.0, 1.0, 1.0 + xx / W - progress * 2.0);
    r = mix(a, b, s);
  }
  else if (u_kind >= 20 && u_kind <= 23) {
    bool horiz = u_kind <= 21;
    float L = horiz ? W : H;
    float pos = horiz ? x : y;
    float z = (u_kind == 20 || u_kind == 22) ? -progress * L : progress * L;
    float zx = z + pos;
    float zz = mod(zx, L);
    vec2 q = horiz ? vec2(zz, y) : vec2(x, zz);
    r = (zx >= 0.0 && zx < L) ? B(q) : A(q);
  }
  else if (u_kind == 24) r = x >= progress * W ? B(vec2(x - progress * W, y)) : a;
  else if (u_kind == 25) r = x < (1.0 - progress) * W ? B(vec2(x + progress * W, y)) : a;
  else if (u_kind == 26) r = x < progress * W ? A(vec2(x + (1.0 - progress) * W, y)) : b;
  else if (u_kind == 27) r = x >= (1.0 - progress) * W ? A(vec2(x - (1.0 - progress) * W, y)) : b;
  else if (u_kind == 30 || u_kind == 31) {
    float z = length(vec2(W, H) * 0.5);
    float d = length(q - R * 0.5) / z;
    if (u_kind == 30) r = mix(b, a, smoothstep(0.0, 1.0, d + (progress - 0.5) * 3.0));
    else r = mix(a, b, smoothstep(0.0, 1.0, d + (1.0 - progress - 0.5) * 3.0));
  }
  else if (u_kind == 32) {
    float s = atan(x - W / 2.0, y - H / 2.0) - (progress - 0.5) * 3.14159265 * 2.5;
    r = mix(a, b, smoothstep(0.0, 1.0, s));
  }
  else if (u_kind == 33 || u_kind == 34) {
    float d = u_kind == 33 ? abs(y - H / 2.0) / (H / 2.0) : abs(x - W / 2.0) / (W / 2.0);
    r = mix(a, b, smoothstep(-0.15, 0.15, u_p * 1.3 - d));
  }
  o = r;
}`;
