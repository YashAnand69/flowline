import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
class FlowCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private phase: number,
    private offset: number,
  ) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 + this.phase;
    const r = 2.3 + 0.5 * Math.cos(3 * a);
    return target.set(
      r * Math.cos(2 * a),
      r * Math.sin(2 * a),
      0.85 * Math.sin(3 * a) + this.offset,
    );
  }
}
export default function Scene({ progress = 0 }: { progress?: number }) {
  const host = useRef<HTMLDivElement>(null),
    scroll = useRef(progress),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    scroll.current = progress;
  }, [progress]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: devicePixelRatio < 2,
        powerPreference: 'low-power',
      });
    } catch {
      setFailed(true);
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = innerWidth < 760;
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.4 : 1.8));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 11.5);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();
    const group = new THREE.Group();
    scene.add(group);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xa3ed58,
      metalness: 0.72,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.4,
    });
    const curves: FlowCurve[] = [],
      pipes: THREE.Mesh[] = [];
    const geoResources: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const curve = new FlowCurve(i * 0.017, (i - 2) * 0.15);
      curves.push(curve);
      const geometry = new THREE.TubeGeometry(
        curve,
        small ? 180 : 300,
        0.075,
        8,
        true,
      );
      geoResources.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      pipes.push(mesh);
    }
    const ringMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe6ffd0,
      metalness: 0.25,
      roughness: 0.2,
      emissive: 0x9bff3b,
      emissiveIntensity: 1.4,
    });
    const beadGeometry = new THREE.SphereGeometry(0.1, 12, 12);
    geoResources.push(beadGeometry);
    const beads = Array.from({ length: 12 }, (_, i) => {
      const bead = new THREE.Mesh(beadGeometry, ringMaterial);
      group.add(bead);
      return bead;
    });
    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      dustPositions[i * 3] = Math.sin(i * 127.1) * 12;
      dustPositions[i * 3 + 1] = Math.cos(i * 311.7) * 8;
      dustPositions[i * 3 + 2] = Math.sin(i * 74.7) * 8 - 5;
    }
    dustGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(dustPositions, 3),
    );
    geoResources.push(dustGeometry);
    const dustMaterial = new THREE.PointsMaterial({
      color: 0x9ab87a,
      size: 0.018,
      transparent: true,
      opacity: 0.4,
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);
    const key = new THREE.DirectionalLight(0xddffb9, 4);
    key.position.set(4, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x487dcf, 2);
    fill.position.set(-4, -3, 2);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pointer = { x: 0, y: 0 };
    let pressed = false;
    const move = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = (e.clientX - rect.left) / rect.width - 0.5;
      pointer.y = (e.clientY - rect.top) / rect.height - 0.5;
    };
    const down = () => {
      pressed = true;
    };
    const up = () => {
      pressed = false;
    };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let frame = 0,
      visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(container);
    let start = performance.now(),
      smooth = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (!visible || document.hidden) return;
      const time = (performance.now() - start) * 0.00015;
      smooth += (scroll.current - smooth) * 0.05;
      const p = reduced ? 0 : smooth;
      group.rotation.x = THREE.MathUtils.lerp(
        group.rotation.x,
        0.28 + pointer.y * 0.3 + p * 2,
        0.04,
      );
      group.rotation.y = THREE.MathUtils.lerp(
        group.rotation.y,
        -0.4 + pointer.x * 0.5 + p * 3.3 + (reduced ? 0 : time * 0.35),
        0.035,
      );
      group.rotation.z = -0.4 + p * 0.9;
      const size = pressed ? 1.06 : 1;
      group.scale.lerp(new THREE.Vector3(size, size, size), 0.05);
      for (let i = 0; i < pipes.length; i++)
        pipes[i].position.z = Math.sin(p * Math.PI) * (i - 2) * 0.7;
      beads.forEach((bead, i) => {
        const curve = curves[i % 5];
        bead.position.copy(
          curve.getPoint(
            (i / 12 + (reduced ? 0 : time * (pressed ? 2 : 0.65))) % 1,
          ),
        );
        bead.position.z += pipes[i % 5].position.z;
      });
      dust.rotation.z = p * 0.1;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      io.disconnect();
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      geoResources.forEach((g) => g.dispose());
      material.dispose();
      ringMaterial.dispose();
      dustMaterial.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="three-scene"
      ref={host}
      role="img"
      aria-label="Five luminous data paths form a moving three-dimensional knot, unfolding as you scroll."
    >
      {failed && (
        <div className="scene-fallback">
          <span>∞</span>
          <p>Everything, connected.</p>
        </div>
      )}
    </div>
  );
}
