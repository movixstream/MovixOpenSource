/*! Morph Slider adapted from React Bits — Copyright (c) 2026 David Haz.
 * https://reactbits.dev/components/morph-slider
 * MIT + Commons Clause; see react-bits.LICENSE.md in this directory.
 * Movix: controlled selection, on-demand rendering, bounded texture cache,
 * and the existing hero's crop and HTML fallback. */
import { useEffect, useRef, useState } from 'react';
import { Mesh, Program, Renderer, RenderTarget, Texture, Triangle } from 'ogl';
import type { MotionValue } from 'framer-motion';
import type { MorphFrame } from './MorphContent';

const DURATION_MS = 1100;
const IMAGE_TIMEOUT_MS = 15000;
const GPU_PREPARATION_TIMEOUT_MS = 3000;

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// React Bits' melt transition, with its default intensity, scale and aberration.
// There is no idle drift: the GPU only draws during a transition or resize.
const fragment = `
precision highp float;
uniform sampler2D tCurrent;
uniform sampler2D tNext;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;
uniform float uProgress;
uniform float uTime;
varying vec2 vUv;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  // Keep the same noise range when the mobile shader omits the fine octaves.
  return v * FBM_NORMALIZATION;
}

vec2 coverUV(vec2 uv, vec2 img) {
  float ratio = (uResolution.x / max(uResolution.y, 1.0)) / (img.x / max(img.y, 1.0));
  vec2 s = ratio > 1.0 ? vec2(1.0, 1.0 / ratio) : vec2(ratio, 1.0);
  // Match object-position: center 30% (WebGL's vertical axis points up).
  return uv * s + (1.0 - s) * vec2(0.5, 0.7);
}

void main() {
  float p = clamp(uProgress, 0.0, 1.0);
  if (p <= 0.0) {
    gl_FragColor = texture2D(tCurrent, coverUV(vUv, uCurrentSize));
    return;
  }
  if (p >= 1.0) {
    gl_FragColor = texture2D(tNext, coverUV(vUv, uNextSize));
    return;
  }

  float nn = fbm(vUv * 2.4 + uTime * 0.03);
  float warp = fbm(vUv * 2.4 * 1.7 - uTime * 0.02);
  vec2 g = vec2(nn, warp) - 0.5;
  vec2 sC = coverUV(vUv + g * 0.55 * 0.5 * p, uCurrentSize);
  vec2 sN = coverUV(vUv - g * 0.55 * 0.5 * (1.0 - p), uNextSize);
  float m = smoothstep(nn - 0.15, nn + 0.15, p);
#ifdef MOBILE_MORPH
  // Two samples instead of six: keep the melt without chromatic aberration.
  gl_FragColor = mix(texture2D(tCurrent, sC), texture2D(tNext, sN), m);
#else
  float ca = 0.35 * sin(p * 3.14159265359) * 0.03;
  vec3 colC = vec3(
    texture2D(tCurrent, sC + vec2(ca, 0.0)).r,
    texture2D(tCurrent, sC).g,
    texture2D(tCurrent, sC - vec2(ca, 0.0)).b
  );
  vec3 colN = vec3(
    texture2D(tNext, sN + vec2(ca, 0.0)).r,
    texture2D(tNext, sN).g,
    texture2D(tNext, sN - vec2(ca, 0.0)).b
  );
  gl_FragColor = vec4(mix(colC, colN, m), 1.0);
#endif
}
`;

export type MorphStatus = 'loading' | 'ready' | 'unavailable';

export interface MorphBackdropProps {
  images: string[];
  selectedIndex: number;
  active: boolean;
  frame: MotionValue<MorphFrame>;
  onStatusChange: (status: MorphStatus) => void;
  speed: number;
  mobile: boolean;
}

interface LoadedImage {
  texture: Texture;
  size: [number, number];
}

export default function MorphBackdrop({ images, selectedIndex, active, frame, onStatusChange, speed, mobile }: MorphBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef({ selectedIndex, active });
  const syncRef = useRef<(() => void) | null>(null);
  const speedRef = useRef(speed);
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(() => { speedRef.current = speed; }, [speed]);

  useEffect(() => {
    selectionRef.current = { selectedIndex, active };
    syncRef.current?.();
  }, [selectedIndex, active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || images.length === 0) return;

    let disposed = false;
    let revision = 0;
    let raf = 0;
    let preloadTimer: ReturnType<typeof setTimeout> | null = null;
    let current: number | null = null;
    let target: number | null = null;
    const textures = new Map<number, LoadedImage>();
    const pending = new Map<number, { promise: Promise<LoadedImage | null>; cancel: () => void; promote: () => void; upload?: () => void }>();
    const disposers: (() => void)[] = [];
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    canvas.style.visibility = 'hidden';
    container.appendChild(canvas);
    onStatusChange('loading');

    const dispose = (status: MorphStatus = 'loading') => {
      if (disposed) return;
      disposed = true;
      revision++;
      cancelAnimationFrame(raf);
      if (preloadTimer !== null) clearTimeout(preloadTimer);
      syncRef.current = null;
      pending.forEach((load) => load.cancel());
      pending.clear();
      disposers.reverse().forEach((release) => release());
      canvas.remove();
      onStatusChange(status);
    };

    try {
      const renderer = new Renderer({ canvas, alpha: false, antialias: false, depth: false, dpr: Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5) });
      const gl = renderer.gl;
      disposers.push(() => gl.getExtension('WEBGL_lose_context')?.loseContext());
      const geometry = new Triangle(gl);
      disposers.push(() => geometry.remove());
      const program = new Program(gl, {
        vertex,
        fragment: (mobile
          ? '#define MOBILE_MORPH\n#define FBM_OCTAVES 3\n#define FBM_NORMALIZATION (31.0 / 28.0)\n'
          : '#define FBM_OCTAVES 5\n#define FBM_NORMALIZATION 1.0\n') + fragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tCurrent: { value: null },
          tNext: { value: null },
          uResolution: { value: [1, 1] },
          uCurrentSize: { value: [1, 1] },
          uNextSize: { value: [1, 1] },
          uProgress: { value: 0 },
          uTime: { value: 0 },
        },
      });
      disposers.push(() => program.remove());
      disposers.push(() => {
        textures.forEach(({ texture }) => gl.deleteTexture(texture.texture));
        textures.clear();
      });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
        dispose('unavailable');
        return;
      }
      const mesh = new Mesh(gl, { geometry, program });
      // A real draw exercises the transition branch as well as texture upload.
      // Merely linking the program or drawing progress=0 leaves that work cold.
      const warmupTarget = new RenderTarget(gl, { width: 1, height: 1, depth: false });
      disposers.push(() => {
        gl.deleteFramebuffer(warmupTarget.buffer);
        gl.deleteTexture(warmupTarget.texture.texture);
      });
      const gl2 = renderer.isWebgl2 ? gl as WebGL2RenderingContext : null;
      let preparationFence: WebGLSync | null = null;
      const releasePreparation = () => {
        if (preparationFence) gl2?.deleteSync(preparationFence);
        preparationFence = null;
      };
      disposers.push(releasePreparation);

      const neighbours = (index: number) => new Set([
        (index + 1) % images.length, (index - 1 + images.length) % images.length,
      ]);
      const pruneTextures = () => {
        const keep = neighbours(selectionRef.current.selectedIndex);
        for (const [index, image] of textures) {
          if (textures.size <= 4) break;
          if (index === current || index === target || index === selectionRef.current.selectedIndex || keep.has(index)) continue;
          gl.deleteTexture(image.texture.texture);
          textures.delete(index);
        }
      };

      const loadTexture = (index: number, prefetch = false): Promise<LoadedImage | null> => {
        if (disposed || gl.isContextLost() || !images[index]) return Promise.resolve(null);
        const cached = textures.get(index);
        if (cached) return Promise.resolve(cached);
        const loading = pending.get(index);
        if (loading) {
          // Promote both the download and its deferred GPU upload.
          if (!prefetch) loading.promote();
          return loading.promise;
        }
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.fetchPriority = prefetch ? 'low' : 'high';
        let required = !prefetch;
        let finished = false;
        let finish: (value: LoadedImage | null) => void;
        const promise = new Promise<LoadedImage | null>((resolve) => { finish = resolve; });
        const complete = (loaded: LoadedImage | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          pending.delete(index);
          finish(loaded);
        };
        const cancel = () => {
          complete(null);
          image.removeAttribute('src');
        };
        // A stalled image must release autoplay and the static fallback.
        const timeout = setTimeout(cancel, IMAGE_TIMEOUT_MS);
        pending.set(index, { promise, cancel, promote: () => {
          required = true;
          image.fetchPriority = 'high';
          pending.get(index)?.upload?.();
        } });
        const upload = () => {
          if (finished || disposed) return;
          let texture: Texture | undefined;
          try {
            texture = new Texture(gl, { image, generateMipmaps: false, minFilter: gl.LINEAR });
            // OGL otherwise waits for the first animation frame to upload.
            texture.update();
            const loaded: LoadedImage = { texture, size: [image.naturalWidth, image.naturalHeight] };
            textures.set(index, loaded);
            pruneTextures();
            complete(loaded);
          } catch {
            if (texture) gl.deleteTexture(texture.texture);
            complete(null);
            dispose('unavailable');
          }
        };
        image.onload = async () => {
          try { await image.decode(); } catch { complete(null); return; }
          if (finished || disposed) return;
          const loading = pending.get(index);
          if (!loading) return;
          loading.upload = upload;
          if (required) upload();
          else preloadNeighbours();
        };
        image.onerror = () => complete(null);
        image.src = images[index];
        return promise;
      };

      const preloadNeighbours = () => {
        if (preloadTimer !== null) clearTimeout(preloadTimer);
        preloadTimer = null;
        if (disposed || target !== null || current === null || !selectionRef.current.active) return;
        const indices = neighbours(selectionRef.current.selectedIndex);
        indices.forEach((index) => { void loadTexture(index, true); });
        const ready = [...indices].map((index) => pending.get(index)?.upload).find(Boolean);
        if (!ready) return;
        // One upload per task, outside the transition's animation frames.
        preloadTimer = setTimeout(() => {
          preloadTimer = null;
          if (disposed || target !== null || !selectionRef.current.active) return;
          ready();
          preloadNeighbours();
        }, 0);
      };

      const draw = () => {
        if (disposed || gl.isContextLost() || !selectionRef.current.active) return false;
        try {
          renderer.render({ scene: mesh });
          return true;
        } catch {
          // A CORS failure or unavailable GPU must leave the HTML image usable.
          dispose('unavailable');
          return false;
        }
      };

      const commit = (index: number, image: LoadedImage) => {
        current = index;
        target = null;
        program.uniforms.tCurrent.value = image.texture;
        program.uniforms.tNext.value = image.texture;
        program.uniforms.uCurrentSize.value = image.size;
        program.uniforms.uNextSize.value = image.size;
        program.uniforms.uProgress.value = 0;
        pruneTextures();
      };

      const sync = async () => {
        if (disposed || gl.isContextLost()) return;
        const request = ++revision;
        cancelAnimationFrame(raf);
        releasePreparation();
        if (target !== null && program.uniforms.uProgress.value >= 0.5) current = target;
        target = null;
        const { selectedIndex: index, active: visible } = selectionRef.current;
        const displayed = frame.get();
        const start = current ?? Math.min(displayed.progress >= 0.5 ? displayed.to : displayed.from, images.length - 1);
        const keep = neighbours(index);
        keep.add(index);
        keep.add(start);
        pending.forEach((load, pendingIndex) => {
          if (!visible || !keep.has(pendingIndex)) load.cancel();
        });
        if (!visible) {
          current = null;
          canvas.style.visibility = 'hidden';
          onStatusChange('loading');
          return;
        }
        onStatusChange('loading');

        // Rebind both samplers before pruning an interrupted transition's
        // textures, including while the latest requested image is loading.
        const settled = current === null ? undefined : textures.get(current);
        if (current !== null && settled) {
          commit(current, settled);
          if (draw()) frame.set({ from: current, to: current, progress: 1 });
        }

        // Selection may change while the lazy chunk or its first image is
        // loading. Seed the renderer from what is still displayed, not from
        // the latest requested slide, so the very first gesture also morphs.
        const nextPromise = loadTexture(index);
        if (current === null) {
          const initial = await loadTexture(start);
          if (disposed || gl.isContextLost() || request !== revision) return;
          if (initial) {
            commit(start, initial);
            if (!draw()) return;
            canvas.style.visibility = 'visible';
            frame.set({ from: start, to: start, progress: 1 });
          }
        }
        const next = await nextPromise;
        if (disposed || gl.isContextLost() || request !== revision) return;
        if (!next) {
          current = null;
          canvas.style.visibility = 'hidden';
          onStatusChange('unavailable');
          return;
        }

        const previous = current === null ? undefined : textures.get(current);
        if (current === null || !previous || current === index) {
          commit(index, next);
          if (draw()) {
            canvas.style.visibility = 'visible';
            frame.set({ from: index, to: index, progress: 1 });
            onStatusChange('ready');
          }
        } else {
          const from = current;
          target = index;
          program.uniforms.tCurrent.value = previous.texture;
          program.uniforms.tNext.value = next.texture;
          program.uniforms.uCurrentSize.value = previous.size;
          program.uniforms.uNextSize.value = next.size;
          program.uniforms.uProgress.value = 0;
          frame.set({ from, to: index, progress: 0 });
          try {
            // Keep the outgoing canvas intact while warming the full shader
            // with both images. A non-blocking fence waits for GPU readiness,
            // so Chrome's first upload/draw cannot consume the animation clock.
            program.uniforms.uProgress.value = 0.5;
            renderer.render({ scene: mesh, target: warmupTarget });
            program.uniforms.uProgress.value = 0;
            preparationFence = gl2?.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0) ?? null;
            gl.flush();
          } catch {
            dispose('unavailable');
            return;
          }
          const preparationStarted = performance.now();
          let startedAt: number | null = null;
          const duration = DURATION_MS / speedRef.current;
          const tick = (now: number) => {
            if (disposed || gl.isContextLost() || request !== revision) return;
            if (preparationFence && gl2) {
              const status = gl2.clientWaitSync(preparationFence, 0, 0);
              if (status === gl2.TIMEOUT_EXPIRED) {
                if (now - preparationStarted >= GPU_PREPARATION_TIMEOUT_MS) dispose('unavailable');
                else raf = requestAnimationFrame(tick);
                return;
              }
              releasePreparation();
              if (status === gl2.WAIT_FAILED) {
                if (!gl.isContextLost()) dispose('unavailable');
                return;
              }
            }
            const firstFrame = startedAt === null;
            // Exclude startup work, then use real elapsed time. Clamping every
            // slow frame used to stretch a 1.1s transition for several seconds.
            startedAt ??= now;
            const progress = Math.min(Math.max(now - startedAt, 0) / duration, 1);
            // Same cubic in/out curve as React Bits' power2.inOut default.
            const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
            program.uniforms.uProgress.value = eased;
            program.uniforms.uTime.value = now * 0.001;
            if (progress === 1) commit(index, next);
            if (!draw()) return;
            frame.set({ from: progress === 1 ? index : from, to: index, progress: eased });
            canvas.style.visibility = 'visible';
            if (firstFrame) onStatusChange('ready');
            if (progress < 1) raf = requestAnimationFrame(tick);
            else preloadNeighbours();
          };
          raf = requestAnimationFrame(tick);
        }

        // Initial display or completed transition: warm both circular neighbours.
        // During a transition, the final tick resumes this bounded queue.
        preloadNeighbours();
      };

      const resize = () => {
        if (disposed) return;
        const { width, height } = container.getBoundingClientRect();
        renderer.setSize(Math.max(width, 1), Math.max(height, 1));
        program.uniforms.uResolution.value = [canvas.width, canvas.height];
        if (current !== null) draw();
      };
      const observer = new ResizeObserver(resize);
      disposers.push(() => observer.disconnect());
      observer.observe(container);
      const onContextLost = (event: Event) => {
        // Keep the canvas alive so Chrome can restore its context. Disposing
        // here left every later selection on the static fallback until remount.
        event.preventDefault();
        revision++;
        cancelAnimationFrame(raf);
        releasePreparation();
        if (preloadTimer !== null) clearTimeout(preloadTimer);
        preloadTimer = null;
        pending.forEach((load) => load.cancel());
        current = target = null;
        canvas.style.visibility = 'hidden';
        onStatusChange('unavailable');
      };
      const onContextRestored = () => {
        if (!disposed) setContextVersion((version) => version + 1);
      };
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
      disposers.push(() => canvas.removeEventListener('webglcontextlost', onContextLost));
      disposers.push(() => canvas.removeEventListener('webglcontextrestored', onContextRestored));
      resize();
      syncRef.current = () => { void sync(); };
      void sync();
    } catch {
      dispose('unavailable');
    }

    return () => dispose();
  }, [images, frame, onStatusChange, contextVersion, mobile]);

  return <div ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />;
}
