export const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_position;

void main() {
  v_position = a_position;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const fragmentShaderSource = `
precision highp float;

varying vec2 v_position;
uniform sampler2D u_texture;
uniform vec2 u_viewport;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_hfov;
uniform float u_horizontalSpan;
uniform float u_verticalSpan;
uniform float u_horizontalCurvature;
uniform float u_verticalCurvature;
uniform float u_edgeCompression;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_horizonY;
uniform float u_edgeFeather;
uniform int u_edgeMode;

const float PI = 3.141592653589793;

float mirrorCoordinate(float value) {
  float segment = floor(value);
  float local = fract(value);
  return mod(abs(segment), 2.0) < 1.0 ? local : 1.0 - local;
}

void main() {
  float aspect = u_viewport.x / max(u_viewport.y, 1.0);
  float tanHalfFov = tan(radians(u_hfov) * 0.5);
  vec3 ray = normalize(vec3(
    v_position.x * tanHalfFov,
    v_position.y * tanHalfFov / aspect,
    1.0
  ));

  float pitch = radians(u_pitch);
  float cp = cos(pitch);
  float sp = sin(pitch);
  ray = vec3(ray.x, cp * ray.y + sp * ray.z, -sp * ray.y + cp * ray.z);

  float yaw = radians(u_yaw);
  float cy = cos(yaw);
  float sy = sin(yaw);
  ray = vec3(cy * ray.x + sy * ray.z, ray.y, -sy * ray.x + cy * ray.z);

  float safeZ = max(ray.z, 0.015);
  float safeHorizontalSpan = min(u_horizontalSpan, 178.0);
  float flatX = (ray.x / safeZ) / tan(radians(safeHorizontalSpan) * 0.5);
  float flatY = (ray.y / safeZ) / tan(radians(min(u_verticalSpan, 170.0)) * 0.5);

  float theta = atan(ray.x, ray.z);
  float cylinderX = theta / max(radians(u_horizontalSpan) * 0.5, 0.001);
  float cylinderY = (ray.y / max(length(ray.xz), 0.015)) /
    tan(radians(min(u_verticalSpan, 170.0)) * 0.5);
  float sphereY = asin(clamp(ray.y, -1.0, 1.0)) /
    max(radians(u_verticalSpan) * 0.5, 0.001);

  float horizontal = mix(flatX, cylinderX, u_horizontalCurvature);
  horizontal = horizontal /
    (1.0 + u_edgeCompression * abs(horizontal));
  float verticalBase = mix(flatY, cylinderY, u_horizontalCurvature);
  float vertical = mix(verticalBase, sphereY, u_verticalCurvature);

  vec2 rawUV = vec2(
    u_centerX + horizontal * 0.5,
    u_horizonY - vertical * 0.5 + (u_centerY - 0.5)
  );
  vec2 uv = rawUV;
  bool outside = rawUV.x < 0.0 || rawUV.x > 1.0 ||
    rawUV.y < 0.0 || rawUV.y > 1.0;

  if (u_edgeMode == 0) {
    uv.x = fract(rawUV.x);
    uv.y = clamp(rawUV.y, 0.0, 1.0);
  } else if (u_edgeMode == 3) {
    uv = vec2(mirrorCoordinate(rawUV.x), mirrorCoordinate(rawUV.y));
  } else {
    uv = clamp(rawUV, 0.0, 1.0);
  }

  vec4 color = texture2D(u_texture, uv);
  vec4 background = vec4(0.025, 0.055, 0.04, 1.0);

  if ((u_edgeMode == 1 || u_edgeMode == 2) && outside) {
    color = background;
  } else if (u_edgeMode == 4 && outside) {
    color = mix(background, color, 0.18);
  }

  if (u_edgeMode == 2 && !outside) {
    float edgeDistance = min(min(rawUV.x, 1.0 - rawUV.x),
      min(rawUV.y, 1.0 - rawUV.y));
    float feather = smoothstep(0.0, max(u_edgeFeather, 0.0001), edgeDistance);
    color = mix(background, color, feather);
  }

  gl_FragColor = color;
}
`;

