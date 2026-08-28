"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The solid itself, turnable.
 *
 * Four fixed 384-pixel views cannot show a tooth flank, the floor of a blind
 * bore, or which of two spiral leads is right, and no amount of re-rendering
 * puts that information into the picture. A rater said as much: the images are
 * small and do not show enough to judge from.
 *
 * Two things make this a comparison rather than three separate toys:
 *
 *  - **One camera.** Orbit any panel and all three turn together, so the eye
 *    compares the same aspect of all three solids instead of remembering one
 *    orientation while hunting for it in another.
 *  - **One scale.** Every solid is placed by the *reference's* centre and
 *    longest axis, the same rule the still images use, so a part that is 8 %
 *    small looks 8 % small here too rather than being auto-fitted to the frame
 *    and silently corrected.
 */

export type Frame = { centre: [number, number, number]; longest: number };
export type Orbit = { theta: number; phi: number; dist: number };

export const DEFAULT_ORBIT: Orbit = { theta: -0.7, phi: 1.1, dist: 2.6 };

const MAGIC = "PLMESH1\0";

/** Decode the `PLMESH1` payload into raw-unit positions and indices. */
function decode(buf: ArrayBuffer): {
  pos: Float32Array; idx: Uint32Array;
  /** the solid's own bounds, in the STEP's units */
  lo: number[]; hi: number[];
} {
  const dv = new DataView(buf);
  let magic = "";
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(dv.getUint8(i));
  if (magic !== MAGIC) throw new Error("not a PLMESH1 mesh");

  const nv = dv.getUint32(8, true);
  const nt = dv.getUint32(12, true);
  const bits = dv.getUint8(16);
  let o = 20;
  const lo = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
  const hi = [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)];
  o += 24;

  const q = new Uint16Array(buf, o, nv * 3);
  o += nv * 6;
  // Positions were quantised across the bounding box; undo that here so the
  // caller works in the STEP's own units and the reference frame is the only
  // thing that scales anything.
  const pos = new Float32Array(nv * 3);
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = lo[0] + (q[i * 3] / 65535) * span[0];
    pos[i * 3 + 1] = lo[1] + (q[i * 3 + 1] / 65535) * span[1];
    pos[i * 3 + 2] = lo[2] + (q[i * 3 + 2] / 65535) * span[2];
  }

  const idx = new Uint32Array(nt * 3);
  if (bits === 16) {
    const src = new Uint16Array(buf, o, nt * 3);
    for (let i = 0; i < src.length; i++) idx[i] = src[i];
  } else {
    // The 32-bit block is 4-byte aligned only by luck; copy rather than view.
    const src = new Uint32Array(buf.slice(o, o + nt * 12));
    idx.set(src);
  }
  return { pos, idx, lo, hi };
}

export default function Viewer3D({
  mesh, frame, orbit, onOrbit, color = 0x6ec3c0, label, fit = false,
}: {
  mesh: string | null;
  frame: Frame | null;
  /** Place this solid by its OWN bounds instead of the reference's.
   *
   *  Off by default, because a part that is the wrong size should look the
   *  wrong size. But 345 of 880 candidates in this corpus are the right shape
   *  written at a round unit-less size -- `box(1,1,1)` where the reference is
   *  200 mm -- and at 1/200 scale they render as a single pixel. The size error
   *  is a real finding and the footer states it either way; this exists so the
   *  rater can still see the shape they are being asked to judge. */
  fit?: boolean;
  orbit: Orbit;
  onOrbit: (o: Orbit) => void;
  color?: number;
  label?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detail, setDetail] = useState<string>("");
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;

  // --- renderer, created once ------------------------------------------------
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // three throws if it cannot get a WebGL context, and a throw inside an
    // effect unmounts the whole React tree -- the rater loses the entire page
    // to "Application error: a client-side exception has occurred", not just
    // the viewer. Seen on a machine with no GPU acceleration (software
    // renderer, sandboxed), which is what a VM, a remote desktop, or a browser
    // with hardware acceleration switched off looks like. The still images are
    // the primary stimulus and they are fine there, so a missing 3-D view must
    // degrade to a line of text.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err: any) {
      setState("error");
      setDetail("this browser cannot open a 3-D view (no WebGL); the pictures above are the full stimulus");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x28323c, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(2, 3, 4);
    scene.add(key);
    el.appendChild(renderer.domElement);
    three.current = { renderer, scene, camera };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // --- geometry --------------------------------------------------------------
  useEffect(() => {
    const ctx = three.current;
    if (!ctx || !mesh || !frame) return;
    let cancelled = false;
    setState("loading");
    setDetail("");

    (async () => {
      try {
        const res = await fetch(`/api/mesh/${mesh}`, { cache: "force-cache" });
        if (!res.ok) throw new Error(`${res.status}`);
        const { pos, idx, lo, hi } = decode(await res.arrayBuffer());
        if (cancelled) return;

        // Place by the reference's frame, not this solid's own: that is what
        // makes the three panels comparable in size. `fit` overrides it for a
        // solid too small to see, and the footer says which is in force.
        const ownSpan = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
        const ratio = ownSpan / (frame.longest || 1);
        const [cx, cy, cz] = fit
          ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
          : frame.centre;
        const k = 1 / (fit ? ownSpan : frame.longest || 1);
        for (let i = 0; i < pos.length; i += 3) {
          pos[i] = (pos[i] - cx) * k;
          pos[i + 1] = (pos[i + 1] - cy) * k;
          pos[i + 2] = (pos[i + 2] - cz) * k;
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeVertexNormals();

        const old = ctx.scene.getObjectByName("solid");
        if (old) {
          ctx.scene.remove(old);
          (old as THREE.Mesh).geometry.dispose();
        }
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
          color, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
        }));
        m.name = "solid";
        ctx.scene.add(m);
        setState("ready");
        // A ratio near 1 is the normal case and saying so is noise; anything
        // outside a sixth of an octave is a size error the rater should be
        // told about in words rather than left to infer from a small picture.
        const off = ratio < 0.85 || ratio > 1.18
          ? ` · ${ratio < 0.01 ? ratio.toExponential(1) : ratio.toFixed(2)}x reference size${fit ? ", shown fitted" : ""}`
          : "";
        setDetail(`${(idx.length / 3).toLocaleString()} triangles${off}`);
      } catch (err: any) {
        if (!cancelled) {
          setState("error");
          setDetail("mesh unavailable — " + String(err?.message ?? err));
        }
      }
    })();
    return () => { cancelled = true; };
    // `fit` belongs here. It is read inside the effect to decide where the
    // geometry is placed, so leaving it out meant the toggle changed the label
    // on the button and nothing else: the mesh stayed in the reference's frame,
    // the candidate stayed invisible, and the feature looked implemented. Only
    // clicking it showed otherwise.
  }, [mesh, frame, color, fit]);

  // --- draw on every orbit change -------------------------------------------
  useEffect(() => {
    const ctx = three.current;
    if (!ctx) return;
    const { theta, phi, dist } = orbit;
    ctx.camera.position.set(
      dist * Math.sin(phi) * Math.cos(theta),
      dist * Math.cos(phi),
      dist * Math.sin(phi) * Math.sin(theta),
    );
    ctx.camera.lookAt(0, 0, 0);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }, [orbit, state]);

  // --- input. Reported upward so every panel shares one camera. --------------
  const drag = useRef<{ x: number; y: number } | null>(null);
  const handlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      const o = orbitRef.current;
      onOrbit({
        theta: o.theta - dx * 0.008,
        // Clamped short of the poles: at exactly 0 or pi the camera's up vector
        // is parallel to the view and the model flips.
        phi: Math.min(Math.PI - 0.05, Math.max(0.05, o.phi - dy * 0.008)),
        dist: o.dist,
      });
    },
    onPointerUp: () => { drag.current = null; },
    onWheel: (e: React.WheelEvent) => {
      const o = orbitRef.current;
      onOrbit({ ...o, dist: Math.min(8, Math.max(0.6, o.dist * (1 + e.deltaY * 0.0012))) });
    },
  }), [onOrbit]);

  return (
    <div className="v3d">
      <div ref={host} className="v3dcanvas" {...handlers} />
      <div className="v3dfoot">
        <span>{label}</span>
        <span className="lose">
          {state === "loading" ? "loading…"
            : state === "error" ? detail
            : detail}
        </span>
      </div>
    </div>
  );
}
