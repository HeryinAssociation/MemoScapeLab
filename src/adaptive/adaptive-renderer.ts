import {
  DEFAULT_ADAPTIVE_PROJECTION,
  isAdaptiveProjection,
  type AdaptiveProjectionConfig,
  type EdgeMode,
  type ImmersiveScene,
} from "../core/projection-types";
import { fragmentShaderSource, vertexShaderSource } from "./shader-source";

export interface AdaptiveViewState {
  yaw: number;
  pitch: number;
  hfov: number;
}

export interface AdaptiveRendererOptions {
  onViewChange?: (view: AdaptiveViewState) => void;
}

// HTML images already use the top-left origin expected by the projection UVs.
// Flipping during upload makes curvedPhoto appear vertically inverted.
export const HTML_IMAGE_FLIP_Y = 0;

const edgeModeValues: Record<EdgeMode, number> = {
  wrap: 0,
  clamp: 1,
  feather: 2,
  mirror: 3,
  background: 4,
};

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 WebGL 着色器。");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "未知着色器错误";
    gl.deleteShader(shader);
    throw new Error(`WebGL 着色器编译失败：${message}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建 WebGL 程序。");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `WebGL 程序链接失败：${gl.getProgramInfoLog(program) ?? "未知错误"}`,
    );
  }
  return program;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export async function createAdaptiveRenderer(
  container: HTMLElement,
  initialScene: ImmersiveScene,
  options: AdaptiveRendererOptions = {},
) {
  const canvas = document.createElement("canvas");
  canvas.className = "adaptive-canvas";
  canvas.setAttribute("aria-label", "自适应投影实时预览");
  container.replaceChildren(canvas);

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    throw new Error("当前浏览器不支持 WebGL，建议切换为平面静态预览。");
  }

  const program = createProgram(gl);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => {
    const location = gl.getUniformLocation(program, name);
    if (!location) throw new Error(`缺少 WebGL 参数：${name}`);
    return location;
  };

  const uniforms = {
    viewport: uniform("u_viewport"),
    texture: uniform("u_texture"),
    yaw: uniform("u_yaw"),
    pitch: uniform("u_pitch"),
    hfov: uniform("u_hfov"),
    horizontalSpan: uniform("u_horizontalSpan"),
    verticalSpan: uniform("u_verticalSpan"),
    horizontalCurvature: uniform("u_horizontalCurvature"),
    verticalCurvature: uniform("u_verticalCurvature"),
    edgeCompression: uniform("u_edgeCompression"),
    centerX: uniform("u_centerX"),
    centerY: uniform("u_centerY"),
    horizonY: uniform("u_horizonY"),
    edgeFeather: uniform("u_edgeFeather"),
    edgeMode: uniform("u_edgeMode"),
  };

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([7, 16, 12, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let scene = initialScene;
  let projection: AdaptiveProjectionConfig = isAdaptiveProjection(
    scene.projection,
  )
    ? scene.projection
    : DEFAULT_ADAPTIVE_PROJECTION;
  const view: AdaptiveViewState = {
    yaw: scene.view.yaw,
    pitch: scene.view.pitch,
    hfov: scene.view.hfov,
  };
  let source = "";
  let destroyed = false;
  let frame = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let previousPinchDistance = 0;

  const emitView = () => options.onViewChange?.({ ...view });

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(container.clientWidth * ratio));
    const height = Math.max(1, Math.round(container.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = () => {
    frame = 0;
    if (destroyed) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms.texture, 0);
    gl.uniform2f(uniforms.viewport, canvas.width, canvas.height);
    gl.uniform1f(uniforms.yaw, view.yaw);
    gl.uniform1f(uniforms.pitch, view.pitch);
    gl.uniform1f(uniforms.hfov, view.hfov);
    gl.uniform1f(uniforms.horizontalSpan, projection.horizontalSpan);
    gl.uniform1f(uniforms.verticalSpan, projection.verticalSpan);
    gl.uniform1f(
      uniforms.horizontalCurvature,
      projection.horizontalCurvature,
    );
    gl.uniform1f(uniforms.verticalCurvature, projection.verticalCurvature);
    gl.uniform1f(uniforms.edgeCompression, projection.edgeCompression);
    gl.uniform1f(uniforms.centerX, projection.centerX);
    gl.uniform1f(uniforms.centerY, projection.centerY);
    gl.uniform1f(uniforms.horizonY, projection.horizonY);
    gl.uniform1f(uniforms.edgeFeather, projection.edgeFeather);
    gl.uniform1i(uniforms.edgeMode, edgeModeValues[projection.edgeMode]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const requestDraw = () => {
    if (!frame) frame = window.requestAnimationFrame(draw);
  };

  const loadTexture = async (url: string) => {
    source = url;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    if (destroyed || source !== url) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, HTML_IMAGE_FLIP_Y);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image,
    );
    requestDraw();
  };

  const constrainView = () => {
    view.yaw = clamp(view.yaw, scene.view.minYaw, scene.view.maxYaw);
    view.pitch = clamp(
      view.pitch,
      scene.view.minPitch,
      scene.view.maxPitch,
    );
    view.hfov = clamp(view.hfov, scene.view.minHfov, scene.view.maxHfov);
  };

  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const points = [...pointers.values()];
      previousPinchDistance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y,
      );
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      const points = [...pointers.values()];
      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y,
      );
      if (previousPinchDistance > 0) {
        view.hfov *= previousPinchDistance / Math.max(distance, 1);
      }
      previousPinchDistance = distance;
    } else {
      const sensitivity = view.hfov / Math.max(canvas.clientWidth, 1);
      view.yaw -= (event.clientX - previous.x) * sensitivity;
      view.pitch += (event.clientY - previous.y) * sensitivity;
    }
    constrainView();
    emitView();
    requestDraw();
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    previousPinchDistance = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.hfov *= Math.exp(event.deltaY * 0.0012);
    constrainView();
    emitView();
    requestDraw();
  };

  const resizeObserver = new ResizeObserver(requestDraw);
  resizeObserver.observe(container);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  await loadTexture(scene.source);
  constrainView();
  emitView();
  requestDraw();

  return {
    update(nextScene: ImmersiveScene) {
      const previousView = scene.view;
      const previousSource = scene.source;
      scene = nextScene;
      projection = isAdaptiveProjection(scene.projection)
        ? scene.projection
        : DEFAULT_ADAPTIVE_PROJECTION;
      if (nextScene.view.yaw !== previousView.yaw) view.yaw = nextScene.view.yaw;
      if (nextScene.view.pitch !== previousView.pitch)
        view.pitch = nextScene.view.pitch;
      if (nextScene.view.hfov !== previousView.hfov)
        view.hfov = nextScene.view.hfov;
      constrainView();
      if (nextScene.source !== previousSource) {
        void loadTexture(nextScene.source);
      }
      emitView();
      requestDraw();
    },
    destroy() {
      destroyed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      canvas.remove();
    },
  };
}
