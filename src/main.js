import * as THREE from 'three';
import './style.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scene 
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0.45);

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

//Lights 
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
scene.add(new THREE.AmbientLight(0xffffff, 50));
const point = new THREE.PointLight(0xffffff, 50); point.position.set(20,20,20); scene.add(point);
const dir   = new THREE.DirectionalLight(0xffffff, 10); dir.position.set(10,20,10); scene.add(dir);

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
});

// Config
const ANCHOR_NAME = 'bottom'; 
const PLANE_OFFSET = -0.008;
const MAX_ABS_TRAVEL_FRACTION = 0.4;  
const BASE_PUSH_FRACTION = 0.02; // tiny baseline so near parts still separate
const EPS_ON_PLANE = 1e-5;
const NEAR_GAP = 0.015;
const SAME_LAYER_TOL = 0.0007;

// State
let model, planeAnchor = null;
let clusters = [];
let explosion = 0;
let targetExplosion = 0;
let maxDistance = 1;

const plane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const planePoint  = new THREE.Vector3();
const planeHelper = new THREE.PlaneHelper(plane, 0.25);
planeHelper.visible = false;
scene.add(planeHelper);

// Load model
const loader = new GLTFLoader();
loader.load(`${import.meta.env.BASE_URL}mirror.glb`, (gltf) => {
    model = gltf.scene;
    scene.add(model);
    controls.enableZoom = false;

    const modelBox = new THREE.Box3().setFromObject(model);
    maxDistance = modelBox.getSize(new THREE.Vector3()).length();

    planeAnchor = model.getObjectByName(ANCHOR_NAME);
    setPlaneFromMeshWithOffset(planeAnchor, PLANE_OFFSET);

    prepareClusters(model, new Set([planeAnchor]));
    animate();
}, undefined, (err) => console.error(err));

// Explosion setup
function setPlaneFromMeshWithOffset(mesh, offset) {
    mesh.updateWorldMatrix(true, true);

    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const gs = new THREE.Vector3().subVectors(bb.max, bb.min);

    const axisIndex =
        (gs.x <= gs.y && gs.x <= gs.z) ? 0 :
            (gs.y <= gs.x && gs.y <= gs.z) ? 1 : 2;

    const localAxis =
        axisIndex === 0 ? new THREE.Vector3(1,0,0) :
            axisIndex === 1 ? new THREE.Vector3(0,1,0) :
                new THREE.Vector3(0,0,1);

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    planeNormal.copy(localAxis).applyMatrix3(normalMatrix).normalize();
    const wbox  = new THREE.Box3().setFromObject(mesh);
    wbox.getCenter(planePoint);
    planePoint.add(planeNormal.clone().multiplyScalar(offset));

    plane.setFromNormalAndCoplanarPoint(planeNormal, planePoint).normalize();
    planeHelper.plane = plane;
    planeHelper.updateMatrixWorld(true);
}

function prepareClusters(root, alwaysStatic = new Set()) {
    clusters = [];
    root.updateWorldMatrix(true, true);
    const items = [];
    root.traverse((obj) => {
        if (!obj.isMesh || obj.isSkinnedMesh) return;
        if (alwaysStatic.has(obj)) return;
        const wbox = new THREE.Box3().setFromObject(obj);
        const center = wbox.getCenter(new THREE.Vector3());
        const distToPlane = plane.distanceToPoint(center);
        items.push({ obj, wbox, center, distToPlane });
    });

    const N = items.length;
    const adj = Array.from({ length: N }, () => []);
    const near = (a, b, gap) => a.wbox.clone().expandByScalar(gap).intersectsBox(b.wbox);

    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const sameLayer = Math.abs(items[i].distToPlane - items[j].distToPlane) <= SAME_LAYER_TOL;
            if (sameLayer && near(items[i], items[j], NEAR_GAP)) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }
    const seen = new Array(N).fill(false);
    const comps = [];
    for (let i = 0; i < N; i++) {
        if (seen[i]) continue;
        const q = [i]; seen[i] = true;
        const comp = [];
        while (q.length) {
            const u = q.pop();
            comp.push(u);
            for (const v of adj[u]) if (!seen[v]) { seen[v] = true; q.push(v); }
        }
        comps.push(comp);
    }
    const maxAbsTravel = MAX_ABS_TRAVEL_FRACTION * maxDistance;
    const basePush     = BASE_PUSH_FRACTION * maxDistance;
    let maxS = EPS_ON_PLANE;
    const drafts = comps.map(idxList => {
        let minD = +Infinity, maxD = -Infinity;
        const itemsOut = [];

        for (const idx of idxList) {
            const it = items[idx];
            itemsOut.push({
                obj: it.obj,
                origWorld: it.obj.getWorldPosition(new THREE.Vector3()),
            });

            const b = it.wbox;
            const corners = [
                new THREE.Vector3(b.min.x, b.min.y, b.min.z),
                new THREE.Vector3(b.min.x, b.min.y, b.max.z),
                new THREE.Vector3(b.min.x, b.max.y, b.min.z),
                new THREE.Vector3(b.min.x, b.max.y, b.max.z),
                new THREE.Vector3(b.max.x, b.min.y, b.min.z),
                new THREE.Vector3(b.max.x, b.min.y, b.max.z),
                new THREE.Vector3(b.max.x, b.max.y, b.min.z),
                new THREE.Vector3(b.max.x, b.max.y, b.max.z),
            ];
            for (const c of corners) {
                const d = plane.distanceToPoint(c);
                if (d < minD) minD = d;
                if (d > maxD) maxD = d;
            }
        }

        const sAbs = Math.max(EPS_ON_PLANE, Math.min(Math.abs(minD), Math.abs(maxD)));
        if (sAbs > maxS) maxS = sAbs;

        return { items: itemsOut, sAbs };
    });

    const depthScale = maxS > 0 ? (maxAbsTravel / maxS) : 0;
    const NEAR_BAND = 0.002;
    clusters = drafts
        .filter(c => c.sAbs >= NEAR_BAND)
        .map(c => ({ ...c, basePush, depthScale }));

    setExplosion(0, true);
}

// Explosion animation
function setExplosion(f, snap = false) {
    targetExplosion = THREE.MathUtils.clamp(f, 0, 1);
    if (snap) explosion = targetExplosion;
}

function updateExplosion(dt) {
    const speed = 6;
    explosion += (targetExplosion - explosion) * Math.min(1, speed * dt);
    const nrm = plane.normal;

    for (const cl of clusters) {
        const extra = cl.basePush * explosion + (cl.depthScale * cl.sAbs) * explosion;
        const delta = nrm.clone().multiplyScalar(extra);

        for (const it of cl.items) {
            const targetWorld = it.origWorld.clone().add(delta);
            const targetLocal = it.obj.parent.worldToLocal(targetWorld);
            it.obj.position.copy(targetLocal);
        }
    }
}

// Inputs
window.addEventListener('wheel', (e) => {
    const step = 0.06;
    setExplosion(targetExplosion + (e.deltaY < 0 ? step : -step));
}, { passive: true });

// Loop
let last = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    controls.update();
    if (clusters.length) updateExplosion(dt);
    renderer.render(scene, camera);
}
animate();

